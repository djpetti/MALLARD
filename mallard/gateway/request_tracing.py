"""Trace ASGI request progress without consuming or buffering HTTP bodies."""

import asyncio
import os
import re
from time import monotonic
from uuid import uuid4

from loguru import logger
from starlette.types import ASGIApp, Message, Receive, Scope, Send

_REQUEST_ID = re.compile(r"[A-Za-z0-9_.-]{1,128}")


class RequestTracingMiddleware:
    """Log HTTP lifecycle markers before routing and dependency resolution."""

    def __init__(self, app: ASGIApp) -> None:
        """Initialize the tracing wrapper.

        Args:
            app: The ASGI application to observe.
        """
        self.app = app

    async def __call__(
        self, scope: Scope, receive: Receive, send: Send
    ) -> None:
        """Observe HTTP messages while preserving ASGI flow control.

        Args:
            scope: Connection information supplied by the ASGI server.
            receive: The application's incoming-message callable.
            send: The application's outgoing-message callable.
        """
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = next(
            (
                value.decode("latin-1")
                for name, value in scope.get("headers", [])
                if name.lower() == b"x-request-id"
            ),
            "",
        )
        # Bound and validate untrusted IDs to prevent multiline or oversized logs.
        if _REQUEST_ID.fullmatch(request_id) is None:
            request_id = uuid4().hex
        scope.setdefault("state", {})["request_id"] = request_id
        started = monotonic()
        body_complete = False
        response_started = False
        response_complete = False
        disconnected = False
        status: int | None = None
        outcome = "returned"
        trace_logger = logger.bind(
            request_trace=True,
            request_id=request_id,
            pid=os.getpid(),
            method=scope["method"],
            path=scope["path"],
        )

        def log_event(event: str, error_type: str | None = None) -> None:
            """Emit safe, correlated state without bodies, queries, or secrets.

            Args:
                event: The observed lifecycle stage.
                error_type: Exception class name, without its message or locals.
            """
            elapsed = monotonic() - started
            trace_logger.bind(
                event=event,
                elapsed_seconds=elapsed,
                status=status,
                body_complete=body_complete,
                response_started=response_started,
                response_complete=response_complete,
                disconnected=disconnected,
                outcome=outcome,
                error_type=error_type,
            ).info(
                f"ASGI {event} request_id={request_id} pid={os.getpid()} "
                f"method={scope['method']!r} path={scope['path']!r} "
                f"elapsed_seconds={elapsed:.6f} status={status} "
                f"body_complete={body_complete} "
                f"response_started={response_started} "
                f"response_complete={response_complete} "
                f"disconnected={disconnected} outcome={outcome} "
                f"error_type={error_type}"
            )

        async def traced_receive() -> Message:
            """Observe only messages requested by the downstream application."""
            nonlocal body_complete, disconnected
            message = await receive()
            if message["type"] == "http.request":
                if not message.get("more_body", False) and not body_complete:
                    body_complete = True
                    log_event("body_complete")
            elif message["type"] == "http.disconnect" and not disconnected:
                disconnected = True
                log_event("disconnect")
            return message

        async def traced_send(message: Message) -> None:
            """Forward response messages and attach the correlation ID.

            Args:
                message: The outgoing ASGI message.
            """
            nonlocal status, response_started, response_complete
            if message["type"] == "http.response.start":
                # Copy rather than mutate the application's response message.
                message = dict(message)
                message["headers"] = [
                    (name, value)
                    for name, value in message.get("headers", [])
                    if name.lower() != b"x-request-id"
                ] + [(b"x-request-id", request_id.encode("ascii"))]
            await send(message)
            if message["type"] == "http.response.start":
                status = message["status"]
                response_started = True
                log_event("response_start")
            elif message["type"] == "http.response.body" and not message.get(
                "more_body", False
            ):
                response_complete = True
                log_event("response_complete")

        log_event("entry")
        try:
            await self.app(scope, traced_receive, traced_send)
        except asyncio.CancelledError:
            outcome = "cancelled"
            log_event("cancelled", "CancelledError")
            raise
        except Exception as error:
            outcome = "error"
            # Exception messages and tracebacks can contain credentials or bodies.
            log_event("error", type(error).__name__)
            raise
        finally:
            log_event("exit")
