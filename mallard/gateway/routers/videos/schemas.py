"""
Schemas used by the endpoints in `videos`.
"""


from ...backends.objects.models import ObjectRef
from ...schemas import ApiModel


class CreateResponse(ApiModel):
    """
    Response to use for video creation requests.

    Attributes:
        video_id: The ID of the video that was created.
    """

    video_id: ObjectRef
