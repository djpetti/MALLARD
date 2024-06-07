"""
Schemas used by the endpoints in `videos`.
"""


from typing import List

from ....schemas import ApiModel
from ...backends.metadata.schemas import UavVideoMetadata
from ...backends.objects.models import ObjectRef


class CreateResponse(ApiModel):
    """
    Response to use for video creation requests.

    Attributes:
        video_id: The ID of the video that was created.
    """

    video_id: ObjectRef


class MetadataResponse(ApiModel):
    """
    Response to a request for image metadata.

    Attributes:
        metadata: The retrieved metadata for each image.

    """

    metadata: List[UavVideoMetadata]
