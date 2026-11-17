"""Page results and bounded, untrusted continuation-token serialization."""

import base64
import binascii
import re

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr

from ..objects.models import TypedObjectRef

_MAX_CURSOR_LENGTH = 16_384


class QueryPage(BaseModel):
    """A bounded set of artifact references and an optional continuation.

    Attributes:
        image_ids: References returned in the requested order.
        next_cursor: Opaque continuation token, or None on the last page.
    """

    image_ids: list[TypedObjectRef]
    next_cursor: str | None = None


class _CursorPayload(BaseModel):
    """Strict wire format; individual values are checked against SQL columns.

    Attributes:
        version: Serialization and ordering-semantics version.
        fingerprint: Digest binding the cursor to its filters and orderings.
        values: Actual selected values, including unique identity tie breakers.
    """

    model_config = ConfigDict(extra="forbid", strict=True)

    version: StrictInt = Field(ge=1, le=1)
    fingerprint: StrictStr = Field(pattern=r"^[0-9a-f]{64}$")
    values: list[StrictStr | StrictInt | None]


def _encode_cursor(fingerprint: str, values: list[str | int | None]) -> str:
    """Encodes selected values without signing or trusting their contents.

    Args:
        fingerprint: Digest of the effective query and ordering.
        values: JSON-compatible selected ordering values.

    Returns:
        A URL-safe, unpadded continuation token.

    Raises:
        ValueError: If the resulting token exceeds the supported bound.
    """
    payload = _CursorPayload(version=1, fingerprint=fingerprint, values=values)
    token = (
        base64.urlsafe_b64encode(payload.model_dump_json().encode("utf-8"))
        .decode("ascii")
        .rstrip("=")
    )
    if len(token) > _MAX_CURSOR_LENGTH:
        raise ValueError("Cursor exceeds the supported length.")
    return token


def _decode_cursor(cursor: str, fingerprint: str) -> list[str | int | None]:
    """Decodes a bounded token and validates its format and query binding.

    Args:
        cursor: Untrusted URL-safe continuation token.
        fingerprint: Expected digest of the effective query and ordering.

    Returns:
        Ordering values requiring subsequent column-specific validation.

    Raises:
        ValueError: If the token is malformed or belongs to another query.
    """
    if (
        not isinstance(cursor, str)
        or not 0 < len(cursor) <= _MAX_CURSOR_LENGTH
        or re.fullmatch(r"[A-Za-z0-9_-]+", cursor) is None
    ):
        raise ValueError("Invalid cursor encoding or length.")
    try:
        # Strict decoding rejects ignored characters and malformed padding.
        raw = base64.b64decode(
            cursor + "=" * (-len(cursor) % 4), altchars=b"-_", validate=True
        )
        payload = _CursorPayload.model_validate_json(raw)
    except (ValueError, binascii.Error) as error:
        raise ValueError("Invalid cursor payload.") from error
    if payload.fingerprint != fingerprint:
        raise ValueError("Cursor does not match the query or ordering.")
    return payload.values
