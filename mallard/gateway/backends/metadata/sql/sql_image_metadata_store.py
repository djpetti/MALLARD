"""
A metadata store that interfaces with a SQL database.
"""

import dataclasses as py_dataclasses
from functools import cache
from typing import AsyncIterable, Iterable

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.future import select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.orm.exc import NoResultFound

from ...objects.models import ObjectRef
from .. import ImageMetadataStore
from ..schemas import (
    GeoPoint,
    ImageMetadata,
    ImageQuery,
    Ordering,
    UavImageMetadata,
)
from .models import Image


@cache
def _create_session_maker(db_url: str) -> sessionmaker:
    """
    Creates the `sessionmaker` for a particular database.

    Args:
        db_url: The URL of the database.

    Returns:
        The appropriate session-maker.

    """
    engine = create_async_engine(db_url)
    return sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


class SqlImageMetadataStore(ImageMetadataStore):
    """
    A metadata store that interfaces with a SQL database.
    """

    def __init__(self, session: AsyncSession):
        """
        Args:
            session: The session to use for communicating with the database.

        """
        self.__session = session

    @staticmethod
    def __orm_image_to_pydantic(image: Image) -> UavImageMetadata:
        """
        Converts an ORM image model to a Pydantic model.

        Args:
            image: The image model to convert.

        Returns:
            The converted model.

        """
        metadata = UavImageMetadata.from_orm(image)

        # Set the location correctly.
        location = GeoPoint(
            latitude_deg=image.location_lat, longitude_deg=image.location_lon
        )
        return py_dataclasses.replace(metadata, location=location)

    @staticmethod
    def __pydantic_to_orm_image(
        object_id: ObjectRef, metadata: ImageMetadata
    ) -> Image:
        """
        Converts a Pydantic metadata model to an ORM image model.

        Args:
            object_id: The corresponding reference to the image in the object
                store.
            metadata: The Pydantic model to convert.

        Returns:
            The converted model.

        """
        # Convert to the format used by the database.
        model_attributes = metadata.dict()
        # Convert location format.
        model_attributes.pop("location")
        location_lat = metadata.location.latitude_deg
        location_lon = metadata.location.longitude_deg

        return Image(
            bucket=object_id.bucket,
            key=object_id.name,
            location_lat=location_lat,
            location_lon=location_lon,
            **model_attributes
        )

    async def __get_by_id(self, object_id: ObjectRef) -> Image:
        """
        Gets a particular image from the database by its unique ID.

        Args:
            object_id: The unique ID of the image.

        Returns:
            The ORM image that it retrieved.

        Raises:
            - `KeyError` if no such image exists.

        """
        query = select(Image).where(
            Image.bucket == object_id.bucket, Image.name == object_id.name
        )
        query_results = await self.__session.execute(query)

        try:
            return query_results.one()
        except NoResultFound:
            raise KeyError("No metadata for image '{}'.", object_id)

    async def add(
        self, *, object_id: ObjectRef, metadata: ImageMetadata
    ) -> None:
        logger.debug("Adding metadata for object {}.", object_id)

        # Add the new image.
        image = self.__pydantic_to_orm_image(object_id, metadata)
        self.__session.add(image)
        await self.__session.commit()

    async def get(self, object_id: ObjectRef) -> UavImageMetadata:
        return self.__orm_image_to_pydantic(await self.__get_by_id(object_id))

    async def delete(self, object_id: ObjectRef) -> None:
        logger.debug("Deleting metadata for object {}.", object_id)

        orm_image = await self.__get_by_id(object_id)
        await self.__session.delete(orm_image)

    async def query(
        self,
        query: ImageQuery,
        orderings: Iterable[Ordering] = (),
        skip_first: int = 0,
        max_num_results: int = 500,
    ) -> AsyncIterable[ObjectRef]:
        pass
