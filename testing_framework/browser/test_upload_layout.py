"""Regression tests for the upload dialog's responsive layout."""

import base64
from collections.abc import Iterator
from typing import Any
from urllib.parse import urlparse

import pytest
from faker import Faker
from playwright.sync_api import Page, Route, expect
from pydantic import BaseModel


class LayoutCase(BaseModel):
    """Describe a viewport and the upload layout it should display."""

    width: int
    height: int
    touch: bool = False
    mobile: bool = False
    scale: int = 1
    stacked: bool = False
    mobile_browse: bool = False


@pytest.fixture(
    params=[
        pytest.param(LayoutCase(width=1440, height=900), id="desktop"),
        pytest.param(LayoutCase(width=1280, height=720), id="laptop"),
        pytest.param(LayoutCase(width=1280, height=550), id="short-desktop"),
        pytest.param(
            LayoutCase(width=1024, height=768, touch=True),
            id="tablet-landscape",
        ),
        pytest.param(
            LayoutCase(
                width=390,
                height=844,
                touch=True,
                mobile=True,
                scale=3,
                stacked=True,
                mobile_browse=True,
            ),
            id="phone-portrait",
        ),
        pytest.param(
            LayoutCase(
                width=844,
                height=390,
                touch=True,
                mobile=True,
                scale=3,
                mobile_browse=True,
            ),
            id="phone-landscape",
        ),
    ]
)
def layout_case(request: pytest.FixtureRequest) -> LayoutCase:
    """Return a named device layout for the browser context."""
    return request.param


@pytest.fixture
def browser_context_args(
    browser_context_args: dict[str, Any], layout_case: LayoutCase
) -> dict[str, Any]:
    """Apply viewport, touch, and DPR settings before the page is created."""
    return {
        **browser_context_args,
        "viewport": {
            "width": layout_case.width,
            "height": layout_case.height,
        },
        "has_touch": layout_case.touch,
        "is_mobile": layout_case.mobile,
        "device_scale_factor": layout_case.scale,
    }


@pytest.fixture
def upload_page(page: Page, frontend_url: str, faker: Faker) -> Iterator[Page]:
    """Open the dialog and select an image through the real upload workflow."""
    unexpected_requests: list[str] = []
    page_errors: list[str] = []
    metadata = {
        "captureDate": faker.date(),
        "sessionName": faker.word(),
        "platformType": "aerial",
        "camera": faker.word(),
    }

    def mock_api(route: Route) -> None:
        """Return deterministic responses for the upload and gallery APIs."""
        path = urlparse(route.request.url).path
        if path == "/api/query":
            route.fulfill(
                json={"imageIds": [], "pageNum": 1, "isLastPage": True}
            )
        elif path == "/api/images/metadata/infer":
            route.fulfill(json=metadata)
        elif path == "/api/images/create_uav":
            route.fulfill(json={"bucket": "layout-tests", "name": "image.png"})
        else:
            unexpected_requests.append(path)
            route.fulfill(
                status=501, json={"detail": "Unexpected test API call"}
            )

    page.route("**/api/**", mock_api)
    # External fonts are cosmetic; the layout suite must also run offline.
    page.route("https://fonts.googleapis.com/**", lambda route: route.abort())
    page.route("https://fonts.gstatic.com/**", lambda route: route.abort())
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    page.goto(frontend_url)
    page.locator("#add_data").click()

    # A valid generated PNG exercises file selection, preprocessing, and Redux.
    image = page.evaluate(
        """() => {
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = 32;
            canvas.getContext("2d").fillRect(0, 0, 32, 32);
            return canvas.toDataURL("image/png").split(",")[1];
        }"""
    )
    page.locator("#file_input").set_input_files(
        {
            "name": faker.file_name(extension="png"),
            "mimeType": "image/png",
            "buffer": base64.b64decode(image),
        }
    )
    # The regression only appears once metadata is visible, not in an empty modal.
    expect(page.locator("metadata-form #session_name input")).to_have_value(
        metadata["sessionName"]
    )
    expect(page.locator("#done_button")).to_be_enabled()
    page.get_by_role("dialog").evaluate(
        """async (dialog) => {
            await Promise.all(dialog.getAnimations({subtree: true})
                .map(animation => animation.finished));
        }"""
    )
    yield page
    assert not unexpected_requests, unexpected_requests
    assert not page_errors, page_errors


class TestUploadLayout:
    """Verify visual relationships instead of exact CSS rules or snapshots."""

    def test_columns_and_controls_fit(
        self, upload_page: Page, layout_case: LayoutCase
    ) -> None:
        """Keep both columns usable and stack them only on portrait phones."""
        upload = upload_page.locator("#upload_column").bounding_box()
        metadata = upload_page.locator("#metadata_column").bounding_box()
        dialog = upload_page.get_by_role("dialog").bounding_box()
        done = upload_page.locator("#done_button").bounding_box()
        assert upload and metadata and dialog and done
        assert upload["width"] > 0 and upload["height"] > 0
        assert metadata["width"] > 0 and metadata["height"] > 0

        # Allow subpixel rounding while rejecting wrapping or overlapping columns.
        tolerance = 1
        if layout_case.stacked:
            assert metadata["y"] >= upload["y"] + upload["height"] - tolerance
            assert abs(metadata["x"] - upload["x"]) <= tolerance
        else:
            assert abs(metadata["y"] - upload["y"]) <= tolerance
            assert metadata["x"] >= upload["x"] + upload["width"] - tolerance

        assert dialog["x"] >= -tolerance
        assert dialog["y"] >= -tolerance
        assert dialog["x"] + dialog["width"] <= layout_case.width + tolerance
        assert dialog["y"] + dialog["height"] <= layout_case.height + tolerance
        for box in (upload, metadata, done):
            assert box["x"] >= dialog["x"] - tolerance
            assert box["x"] + box["width"] <= (
                dialog["x"] + dialog["width"] + tolerance
            )
        assert done["y"] + done["height"] <= (
            dialog["y"] + dialog["height"] + tolerance
        )

        if layout_case.mobile_browse:
            browse_button = upload_page.locator("#mobile_browse")
            expect(browse_button).to_be_visible()
            browse = browse_button.bounding_box()
            assert browse
            assert (
                abs(
                    browse["x"]
                    + browse["width"] / 2
                    - upload["x"]
                    - upload["width"] / 2
                )
                <= tolerance
            )
            assert browse["y"] >= upload["y"] - tolerance
            assert browse["y"] + browse["height"] <= (
                upload["y"] + upload["height"] + tolerance
            )
