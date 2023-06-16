"""
Data models for object storage.
"""


from pydantic import BaseModel


class ObjectRef(BaseModel):
    """
    Represents a reference to an object in the store.

    Attributes:
        bucket: The name of the bucket that the object is in.
        name: The name of the object.
    """

    class Config:
        frozen = True

    bucket: str
    name: str


def derived_id(object_id: ObjectRef, suffix: str) -> ObjectRef:
    """
    Transforms an object ID to the ID for the corresponding derived object

    Args:
        object_id: The object ID.
        suffix: The suffix to append to the object name.

    Returns:
        The ID for the corresponding derived object.

    """
    derived_name = f"{object_id.name}.{suffix}"
    return ObjectRef(bucket=object_id.bucket, name=derived_name)
