"""
Schemas used by the endpoints in `root`.
"""

from typing import List

from mallard.gateway.backends.objects.models import TypedObjectRef

from ....schemas import ApiModel


class QueryResponse(ApiModel):
    """
    Response to a query for images.

    Attributes:
        image_ids: The IDs of all images found by the query.

        page_num: The legacy page number, or None in cursor mode.
        next_cursor: Continuation token in cursor mode, or None at the end;
            omitted from legacy pagination responses.
        is_last_page: True if this represents the final page of query
            results. Otherwise, there is at least one additional page. Note
            that the last page might be empty.

    """

    image_ids: List[TypedObjectRef]

    page_num: int | None
    is_last_page: bool
    next_cursor: str | None = None
