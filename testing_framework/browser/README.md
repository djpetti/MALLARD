# Frontend layout tests

These tests use the existing `pytest-playwright` development dependency. They
render the production Jinja templates and serve the compiled frontend locally;
no gateway, database, object store, or authentication service is needed. API
responses are mocked at the browser boundary, while file selection,
preprocessing, Redux updates, and web-component rendering run normally.

## Setup and run

Use the project's Python development environment (including the dev dependency
group) and the normal frontend dependencies/generated API client. Activate the
Python environment before invoking the npm script.

From the repository root, install Chromium once:

```sh
python -m playwright install chromium
```

On a fresh Linux CI runner, use `python -m playwright install --with-deps chromium`
to also install system libraries.

From `mallard/edge/frontend`, build and run the browser suite:

```sh
npm run test:browser
```

For a faster rerun against an already-built frontend, run from the repository
root:

```sh
python -m pytest -c testing_framework/browser/pytest.ini testing_framework/browser
```

The dedicated pytest configuration keeps this suite independent of backend
coverage, style-checking, and worker settings. It runs Chromium by default;
`--headed` is useful for debugging. Failures retain a screenshot and Playwright
trace under `test-results/` in the working directory:

```sh
python -m playwright show-trace test-results/<test-name>/trace.zip
```

## Coverage

The upload tests select a generated PNG through the actual file input and wait
for inferred metadata to appear. This matters because an empty dialog does not
expose the desktop column-wrapping regression.

The viewport cases cover desktop, laptop, short non-touch desktop, landscape
tablet, and high-DPR phones in portrait and landscape. Assertions check column
placement, dialog bounds, the Done button, and phone Browse-button positioning.
They use relative geometry with a small rounding tolerance, not pixel-perfect
screenshots or assertions about particular CSS declarations.

The tests use the real viewport meta tag and touch emulation, so mobile layout
viewport and coarse-pointer media queries are exercised too. External font
requests are blocked to keep the suite independent of network access.
