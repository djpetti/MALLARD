"""Behavioral tests for raw ASGI request tracing."""

from __future__ import annotations

import asyncio
import os
import re
from collections.abc import Iterator
from copy import deepcopy
from typing import TYPE_CHECKING, Any

import pytest
from faker import Faker
from fastapi import FastAPI
from loguru import logger
from starlette.types import Message, Receive, Scope, Send

from mallard.gateway.request_tracing import RequestTracingMiddleware

if TYPE_CHECKING:
    from loguru import Message as LogMessage
    from loguru import Record


@pytest.fixture
def captured_logs() -> Iterator[list[LogMessage]]:
    """Capture formatted trace messages and their structured records.

    Yields:
        Messages emitted by the tracing middleware during the test.
    """
    messages: list[LogMessage] = []

    def sink(message: LogMessage) -> None:
        """Retain the formatted message with its original Loguru record."""
        messages.append(message)

    def is_trace(record: Record) -> bool:
        """Select only records explicitly marked as request traces."""
        return bool(record["extra"].get("request_trace", False))

    sink_id = logger.add(sink, filter=is_trace, format="{message}")
    try:
        yield messages
    finally:
        logger.remove(sink_id)


@pytest.fixture
def http_scope(faker: Faker) -> Scope:
    """Build a complete HTTP scope without involving a network client.

    Args:
        faker: Generator for independent request data.

    Returns:
        A scope with existing application state that must be preserved.
    """
    return {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": f"/{faker.slug()}",
        "root_path": "",
        "query_string": b"",
        "headers": [],
        "client": ("127.0.0.1", 12345),
        "server": ("testserver", 80),
        "state": {"existing": faker.word()},
    }


@pytest.fixture
def incoming_messages() -> list[Message]:
    """Provide the mutable queue of messages available to the application."""
    return []


@pytest.fixture
def receive(incoming_messages: list[Message]) -> Receive:
    """Create a receive callable that fails on unexpected extra reads."""

    async def receive_message() -> Message:
        """Return the next queued message without copying it."""
        return incoming_messages.pop(0)

    return receive_message


@pytest.fixture
def sent_messages() -> list[Message]:
    """Provide storage for messages delivered to the ASGI server."""
    return []


@pytest.fixture
def send(sent_messages: list[Message]) -> Send:
    """Create a send callable that retains outgoing message identities."""

    async def send_message(message: Message) -> None:
        """Record the exact message passed to the server."""
        sent_messages.append(message)

    return send_message


def trace_extras(messages: list[LogMessage]) -> list[dict[str, Any]]:
    """Extract structured lifecycle data without depending on log wording.

    Args:
        messages: Messages captured by the custom sink.

    Returns:
        The bound extras for each emitted record, in emission order.
    """
    return [message.record["extra"] for message in messages]


@pytest.mark.asyncio
class TestRequestTracingMiddleware:
    """Exercise tracing through the public ASGI middleware interface."""

    @pytest.mark.parametrize("explicit_final_flag", [False, True])
    async def test_stream_passthrough_and_lifecycle(
        self,
        explicit_final_flag: bool,
        faker: Faker,
        http_scope: Scope,
        incoming_messages: list[Message],
        receive: Receive,
        send: Send,
        sent_messages: list[Message],
        captured_logs: list[LogMessage],
    ) -> None:
        """Preserve streamed messages and report structured lifecycle state."""
        request_id = faker.uuid4()
        http_scope["headers"] = [(b"X-Request-ID", request_id.encode())]
        original_state = http_scope["state"].copy()
        request_chunks: list[Message] = [
            {
                "type": "http.request",
                "body": faker.binary(length=24),
                "more_body": True,
            },
            {"type": "http.request", "body": faker.binary(length=12)},
        ]
        response_chunks: list[Message] = [
            {
                "type": "http.response.start",
                "status": 201,
                "headers": [
                    (b"content-type", b"application/octet-stream"),
                    (b"X-Request-ID", b"application-id"),
                    (b"x-request-id", b"duplicate-id"),
                    (b"set-cookie", b"first=1"),
                    (b"set-cookie", b"second=2"),
                ],
                "trailers": False,
            },
            {
                "type": "http.response.body",
                "body": faker.binary(length=20),
                "more_body": True,
            },
            {"type": "http.response.body", "body": faker.binary(length=10)},
        ]
        if explicit_final_flag:
            request_chunks[-1]["more_body"] = False
            response_chunks[-1]["more_body"] = False
        incoming_messages.extend(request_chunks)
        original_response = deepcopy(response_chunks)

        async def app(scope: Scope, receive: Receive, send: Send) -> None:
            """Consume and produce chunks only when the application chooses."""
            assert scope is http_scope
            assert scope["state"] == {
                **original_state,
                "request_id": request_id,
            }
            assert [
                extra["event"] for extra in trace_extras(captured_logs)
            ] == ["entry"]
            for chunk in request_chunks:
                assert await receive() is chunk
            for chunk in response_chunks:
                await send(chunk)

        await RequestTracingMiddleware(app)(http_scope, receive, send)

        assert not incoming_messages
        assert response_chunks == original_response
        expected_start = deepcopy(original_response[0])
        expected_start["headers"] = [
            (name, value)
            for name, value in expected_start["headers"]
            if name.lower() != b"x-request-id"
        ] + [(b"x-request-id", request_id.encode())]
        assert sent_messages == [expected_start, *response_chunks[1:]]
        assert all(
            actual is original
            for actual, original in zip(sent_messages[1:], response_chunks[1:])
        )

        extras = trace_extras(captured_logs)
        assert [extra["event"] for extra in extras] == [
            "entry",
            "body_complete",
            "response_start",
            "response_complete",
            "exit",
        ]
        for extra in extras:
            assert extra["request_trace"] is True
            assert extra["request_id"] == request_id
            assert extra["pid"] == os.getpid()
            assert extra["method"] == http_scope["method"]
            assert extra["path"] == http_scope["path"]
            assert extra["elapsed_seconds"] >= 0
        assert [extra["elapsed_seconds"] for extra in extras] == sorted(
            extra["elapsed_seconds"] for extra in extras
        )
        assert extras[0]["body_complete"] is False
        assert extras[0]["status"] is None
        assert extras[1]["body_complete"] is True
        assert extras[2]["status"] == 201
        assert extras[2]["response_started"] is True
        assert extras[2]["response_complete"] is False
        assert extras[-1]["response_complete"] is True
        assert extras[-1]["disconnected"] is False
        assert extras[-1]["outcome"] == "returned"

    @pytest.mark.parametrize(
        "supplied_id",
        [
            None,
            b"",
            b"contains spaces",
            b"line\nbreak",
            b"line\rbreak",
            b"a" * 129,
            b"\xff",
            b"valid_ID-1.2",
            b"a" * 128,
        ],
        ids=[
            "missing",
            "empty",
            "spaces",
            "newline",
            "carriage-return",
            "too-long",
            "non-ascii",
            "valid",
            "max-length",
        ],
    )
    async def test_request_id_validation(
        self,
        supplied_id: bytes | None,
        http_scope: Scope,
        receive: Receive,
        send: Send,
        sent_messages: list[Message],
        captured_logs: list[LogMessage],
    ) -> None:
        """Propagate safe IDs or generate a safe ID consistent across outputs."""
        if supplied_id is not None:
            http_scope["headers"] = [(b"x-request-id", supplied_id)]

        async def app(scope: Scope, receive: Receive, send: Send) -> None:
            """Respond without reading a request body."""
            await send(
                {"type": "http.response.start", "status": 204, "headers": []}
            )
            await send({"type": "http.response.body", "body": b""})

        await RequestTracingMiddleware(app)(http_scope, receive, send)

        request_id = http_scope["state"]["request_id"]
        assert re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", request_id)
        if supplied_id in (b"valid_ID-1.2", b"a" * 128):
            assert request_id == supplied_id.decode()
        elif supplied_id is not None:
            assert request_id.encode() != supplied_id
        assert sent_messages[0]["headers"] == [
            (b"x-request-id", request_id.encode())
        ]
        extras = trace_extras(captured_logs)
        assert {extra["request_id"] for extra in extras} == {request_id}
        assert all(extra["body_complete"] is False for extra in extras)

    @pytest.mark.parametrize("scope_type", ["websocket", "lifespan"])
    async def test_non_http_passthrough(
        self,
        scope_type: str,
        receive: Receive,
        send: Send,
        captured_logs: list[LogMessage],
    ) -> None:
        """Leave non-HTTP scopes and their original callables untouched."""
        scope: Scope = {"type": scope_type}
        observed: list[tuple[Scope, Receive, Send]] = []

        async def app(scope: Scope, receive: Receive, send: Send) -> None:
            """Retain the exact ASGI arguments received by the application."""
            observed.append((scope, receive, send))

        await RequestTracingMiddleware(app)(scope, receive, send)

        assert len(observed) == 1
        assert all(
            actual is expected
            for actual, expected in zip(observed[0], (scope, receive, send))
        )
        assert scope == {"type": scope_type}
        assert not captured_logs

    async def test_disconnect(
        self,
        http_scope: Scope,
        incoming_messages: list[Message],
        receive: Receive,
        send: Send,
        captured_logs: list[LogMessage],
    ) -> None:
        """Observe disconnects without inventing a completed request body."""
        disconnect: Message = {"type": "http.disconnect"}
        incoming_messages.extend([disconnect, disconnect])

        async def app(scope: Scope, receive: Receive, send: Send) -> None:
            """Receive repeated disconnect notifications unchanged."""
            assert await receive() is disconnect
            assert await receive() is disconnect

        await RequestTracingMiddleware(app)(http_scope, receive, send)

        extras = trace_extras(captured_logs)
        assert [extra["event"] for extra in extras] == [
            "entry",
            "disconnect",
            "exit",
        ]
        assert extras[-1]["disconnected"] is True
        assert extras[-1]["body_complete"] is False
        assert extras[-1]["response_started"] is False
        assert extras[-1]["status"] is None

    @pytest.mark.parametrize(
        "error_class", [RuntimeError, asyncio.CancelledError]
    )
    @pytest.mark.parametrize("start_response", [False, True])
    async def test_failure_exit_and_privacy(
        self,
        error_class: type[BaseException],
        start_response: bool,
        faker: Faker,
        http_scope: Scope,
        incoming_messages: list[Message],
        receive: Receive,
        send: Send,
        captured_logs: list[LogMessage],
    ) -> None:
        """Reraise failures and log exit state without disclosing private data."""
        secrets = [f"private-{faker.uuid4()}" for _ in range(4)]
        http_scope["query_string"] = f"token={secrets[0]}".encode()
        http_scope["headers"] = [
            (b"authorization", f"Bearer {secrets[1]}".encode()),
            (b"cookie", f"session={secrets[1]}".encode()),
        ]
        incoming_messages.append(
            {"type": "http.request", "body": secrets[2].encode()}
        )
        error = error_class(secrets[3])

        async def app(scope: Scope, receive: Receive, send: Send) -> None:
            """Read private input and then fail at the requested response stage."""
            await receive()
            if start_response:
                await send(
                    {
                        "type": "http.response.start",
                        "status": 202,
                        "headers": [],
                    }
                )
            raise error

        with pytest.raises(error_class) as raised:
            await RequestTracingMiddleware(app)(http_scope, receive, send)

        assert raised.value is error
        extras = trace_extras(captured_logs)
        outcome = (
            "cancelled" if error_class is asyncio.CancelledError else "error"
        )
        assert extras[-2]["event"] == outcome
        assert extras[-2]["error_type"] == error_class.__name__
        assert extras[-1]["event"] == "exit"
        assert extras[-1]["outcome"] == outcome
        assert extras[-1]["body_complete"] is True
        assert extras[-1]["response_started"] is start_response
        assert extras[-1]["response_complete"] is False
        assert extras[-1]["status"] == (202 if start_response else None)
        for message in captured_logs:
            assert all(secret not in str(message) for secret in secrets)
            assert all(
                secret not in repr(message.record["extra"])
                for secret in secrets
            )
            assert message.record["exception"] is None

    async def test_suspended_body_receive(
        self,
        http_scope: Scope,
        send: Send,
        captured_logs: list[LogMessage],
    ) -> None:
        """Emit entry before a suspended body read and completion only afterward."""
        waiting = asyncio.Event()
        release = asyncio.Event()

        async def receive() -> Message:
            """Signal the blocked read and wait for explicit body availability."""
            waiting.set()
            await release.wait()
            return {"type": "http.request", "body": b""}

        async def app(scope: Scope, receive: Receive, send: Send) -> None:
            """Wait for the body without sending a response."""
            await receive()

        task = asyncio.create_task(
            RequestTracingMiddleware(app)(http_scope, receive, send)
        )
        try:
            await asyncio.wait_for(waiting.wait(), timeout=5)
            assert not task.done()
            assert [
                extra["event"] for extra in trace_extras(captured_logs)
            ] == ["entry"]
        finally:
            # Release and reap the task even if an intermediate assertion fails.
            release.set()
            await asyncio.wait_for(task, timeout=5)

        assert [extra["event"] for extra in trace_extras(captured_logs)] == [
            "entry",
            "body_complete",
            "exit",
        ]

    async def test_concurrent_request_separation(
        self,
        faker: Faker,
        http_scope: Scope,
        captured_logs: list[LogMessage],
    ) -> None:
        """Keep IDs, statuses, and body progress isolated for overlapping requests."""
        scopes = [deepcopy(http_scope), deepcopy(http_scope)]
        entered = [asyncio.Event(), asyncio.Event()]
        release = [asyncio.Event(), asyncio.Event()]
        responses: list[list[Message]] = [[], []]
        for index, scope in enumerate(scopes):
            scope["path"] = f"/{faker.slug()}/{index}"

        async def app(scope: Scope, receive: Receive, send: Send) -> None:
            """Synchronize request bodies and send request-specific statuses."""
            await receive()
            index = scopes.index(scope)
            await send(
                {
                    "type": "http.response.start",
                    "status": 201 + index,
                    "headers": [],
                }
            )
            await send({"type": "http.response.body", "body": b""})

        middleware = RequestTracingMiddleware(app)

        async def run_request(index: int) -> None:
            """Drive one request with independently controlled receive and send."""

            async def receive() -> Message:
                """Hold this request's body until its own barrier is released."""
                entered[index].set()
                await release[index].wait()
                return {"type": "http.request", "body": b""}

            async def send(message: Message) -> None:
                """Retain responses separately for this request."""
                responses[index].append(message)

            await middleware(scopes[index], receive, send)

        tasks = [asyncio.create_task(run_request(index)) for index in range(2)]
        try:
            await asyncio.wait_for(
                asyncio.gather(*(event.wait() for event in entered)), timeout=5
            )
            assert [
                extra["event"] for extra in trace_extras(captured_logs)
            ] == [
                "entry",
                "entry",
            ]
            release[1].set()
            await asyncio.wait_for(tasks[1], timeout=5)
            assert not tasks[0].done()
        finally:
            for event in release:
                event.set()
            await asyncio.wait_for(asyncio.gather(*tasks), timeout=5)

        assert (
            scopes[0]["state"]["request_id"]
            != scopes[1]["state"]["request_id"]
        )
        for index, scope in enumerate(scopes):
            request_id = scope["state"]["request_id"]
            extras = [
                extra
                for extra in trace_extras(captured_logs)
                if extra["request_id"] == request_id
            ]
            assert {extra["path"] for extra in extras} == {scope["path"]}
            assert [extra["event"] for extra in extras] == [
                "entry",
                "body_complete",
                "response_start",
                "response_complete",
                "exit",
            ]
            assert extras[0]["body_complete"] is False
            assert extras[0]["status"] is None
            assert extras[-1]["status"] == 201 + index
            assert extras[-1]["response_complete"] is True
            assert responses[index][0]["headers"] == [
                (b"x-request-id", request_id.encode())
            ]

    async def test_outer_fastapi_wrapper_observes_500(
        self,
        faker: Faker,
        http_scope: Scope,
        receive: Receive,
        send: Send,
        sent_messages: list[Message],
        captured_logs: list[LogMessage],
    ) -> None:
        """Observe FastAPI's completed 500 response before its error is reraised."""
        app = FastAPI()
        secret = f"private-{faker.uuid4()}"
        error = RuntimeError(secret)

        @app.post(http_scope["path"])
        async def fail() -> None:
            """Fail inside routing so ServerErrorMiddleware generates the response."""
            raise error

        # Wrapping the complete app places tracing outside ServerErrorMiddleware.
        with pytest.raises(RuntimeError) as raised:
            await RequestTracingMiddleware(app)(http_scope, receive, send)

        assert raised.value is error
        assert sent_messages[0]["status"] == 500
        assert sent_messages[0]["headers"][-1] == (
            b"x-request-id",
            http_scope["state"]["request_id"].encode(),
        )
        extras = trace_extras(captured_logs)
        response_start = next(
            extra for extra in extras if extra["event"] == "response_start"
        )
        assert response_start["status"] == 500
        assert extras[-1]["event"] == "exit"
        assert extras[-1]["status"] == 500
        assert extras[-1]["response_started"] is True
        assert extras[-1]["response_complete"] is True
        assert extras[-1]["body_complete"] is False
        assert extras[-1]["outcome"] == "error"
        assert all(secret not in str(message) for message in captured_logs)
