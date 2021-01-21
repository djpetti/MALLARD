"""
Models used by the endpoints in `images`.
"""


from typing import List

from pydantic import BaseModel

from ...backends.objects.models import ObjectRef


class CreateResponse(BaseModel):
    """
    Response to use for image creation requests.

    Attributes:
        image_id: The unique ID of the image that was created.
    """

    class Config:
        allow_mutation = False

    image_id: ObjectRef


class QueryResponse(BaseModel):
    """
    Response to a query for images.

    Attributes:
        image_ids: The IDs of all images found by the query.

        page_num: The page number that this query was for.
        is_last_page: True if this represents the final page of query
            results. Otherwise, there is at least one additional page. Note
            that the last page might be empty.

    """

    class Config:
        allow_mutation = False

    image_ids: List[ObjectRef]

    page_num: int
    is_last_page: bool
