"""
Data models for object storage.
"""


import enum
import uuid
from datetime import date

from pydantic import BaseModel


@enum.unique
class ObjectType(enum.Enum):
    """
    The type of an object.
    """

    ARTIFACT = "artifact"
    RASTER = "raster"
    IMAGE = "image"
    VIDEO = "video"


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


class TypedObjectRef(BaseModel):
    """
    Represents a reference to an object in the store, with an associated type.

    Attributes:
        id: The object ID.
        type: The type of the object.

    """

    class Config:
        frozen = True

    id: ObjectRef
    type: ObjectType


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


def unique_name() -> str:
    """
    Generates a unique name for an object.

    Returns:
        The generated name.

    """
    return f"{date.today().isoformat()}-{uuid.uuid4().hex}"
