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
