"""Serve the real edge frontend without starting backend services."""

from collections.abc import Iterator
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from typing import Any

import pytest
from jinja2 import Environment, FileSystemLoader, select_autoescape


@pytest.fixture(scope="session")
def frontend_url() -> Iterator[str]:
    """Serve rendered production templates and compiled frontend assets.

    Yields:
        The local frontend URL.
    """
    root = Path(__file__).resolve().parents[2]
    edge = root / "mallard" / "edge"
    bundled = edge / "frontend" / "bundled"
    if not (bundled / "mallard-edge" / "index.js").is_file():
        pytest.fail(
            "Build the frontend with npm run build && npm run bundle first."
        )

    templates = Environment(
        loader=FileSystemLoader(edge / "templates"),
        autoescape=select_autoescape(["html"]),
    )
    document = (
        templates.get_template("index.html")
        .render(
            auth_enabled=False,
            api_base_url="/api",
            auth_base_url="",
            auth_client_id="",
        )
        .encode()
    )

    class FrontendHandler(SimpleHTTPRequestHandler):
        """Serve the real page and static assets with no application backend."""

        def __init__(self, *args: Any, **kwargs: Any) -> None:
            """Limit static file serving to the compiled asset directory."""
            super().__init__(*args, directory=str(bundled), **kwargs)

        def do_GET(self) -> None:
            """Serve the index page or a compiled static asset."""
            if self.path == "/":
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(document)))
                self.end_headers()
                self.wfile.write(document)
            elif self.path.startswith("/static/"):
                # Preserve production asset URLs, including shadow-root stylesheets.
                self.path = self.path.removeprefix("/static")
                super().do_GET()
            else:
                self.send_error(404)

        def log_message(self, format: str, *args: Any) -> None:
            """Keep routine HTTP request logs out of the test output."""

    server = ThreadingHTTPServer(("127.0.0.1", 0), FrontendHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/"
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
