"""
Schemas used by the endpoints in `images`.
"""


from typing import List

from ...backends.metadata.schemas import UavImageMetadata
from ...backends.objects.models import ObjectRef
from ...schemas import ApiModel


class CreateResponse(ApiModel):
    """
    Response to use for image creation requests.

    Attributes:
        image_id: The unique ID of the image that was created.
    """

    image_id: ObjectRef


class MetadataResponse(ApiModel):
    """
    Response to a request for image metadata.

    Attributes:
        metadata: The retrieved metadata for each image.

    """

    metadata: List[UavImageMetadata]
