"""Tests for optional request tracing in the exported gateway application."""

import runpy
from typing import Any

import confuse
import pytest
from loguru import logger
from pytest_mock import MockerFixture
from starlette.testclient import TestClient

import mallard.config as config_module
from mallard.gateway.request_tracing import RequestTracingMiddleware


class TestGatewayConfiguration:
    """Exercise startup configuration through the gateway's ASGI interface."""

    @pytest.mark.parametrize("load_defaults", [False, True])
    @pytest.mark.parametrize("tracing_enabled", [None, False, True])
    def test_request_tracing(
        self,
        load_defaults: bool,
        tracing_enabled: bool | None,
        monkeypatch: pytest.MonkeyPatch,
        mocker: MockerFixture,
    ) -> None:
        """Enable tracing only when explicitly requested in configuration.

        Args:
            load_defaults: Whether to load the gateway's packaged YAML defaults.
            tracing_enabled: An explicit override, or None to leave it unset.
            monkeypatch: Fixture for isolating the global configuration.
            mocker: Fixture for suppressing process-wide logging setup.
        """
        configuration = confuse.Configuration(
            "mallard", modname="mallard.gateway", read=False
        )
        if load_defaults:
            configuration.read(user=False)
            assert (
                configuration["diagnostics"]["enable_request_tracing"].get(
                    bool
                )
                is False
            )
        configuration.set(
            {
                "security": {
                    "enable_auth": False,
                    "api_origins": [],
                    "fief": {
                        "base_url": "",
                        "client_id": "",
                        "verify_ssl": True,
                    },
                }
            }
        )
        if tracing_enabled is not None:
            configuration.set(
                {"diagnostics": {"enable_request_tracing": tracing_enabled}}
            )
        monkeypatch.setattr(config_module, "config", configuration)
        # Startup must not replace the test runner's global logging sinks.
        mocker.patch("mallard.logger.config_logger")
        namespace = runpy.run_module("mallard.gateway.main")
        events: list[dict[str, Any]] = []
        sink_id = logger.add(
            lambda message: events.append(message.record["extra"]),
            filter=lambda record: record["extra"].get("request_trace", False),
        )
        try:
            with TestClient(namespace["app"]) as client:
                response = client.get(
                    "/openapi.json",
                    headers={"X-Request-ID": "configuration-test"},
                )
        finally:
            logger.remove(sink_id)

        assert response.status_code == 200
        assert "/query" in response.json()["paths"]
        if tracing_enabled:
            assert isinstance(namespace["app"], RequestTracingMiddleware)
            assert response.headers["x-request-id"] == "configuration-test"
            assert {event["event"] for event in events} == {
                "entry",
                "response_start",
                "response_complete",
                "exit",
            }
        else:
            # Disabled tracing should avoid the wrapper and its header changes.
            assert namespace["app"] is namespace["gateway_app"]
            assert "x-request-id" not in response.headers
            assert not events
