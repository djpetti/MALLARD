"""
A metadata store that interfaces with a SQL database.
"""
import asyncio
from contextlib import asynccontextmanager
from datetime import timedelta
from functools import singledispatchmethod
from typing import (
    Any,
    AsyncIterable,
    AsyncIterator,
    Generic,
    Iterable,
    Optional,
    Tuple,
    Type,
)

from confuse import ConfigView
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.orm.attributes import InstrumentedAttribute
from sqlalchemy.orm.exc import NoResultFound
from sqlalchemy.sql.expression import Select, delete, select

from ...objects.models import ObjectRef
from ...time_expiring_cache import time_expiring_cache
from .. import MetadataTypeVar, RasterMetadataStore
from ..schemas import (
    GeoPoint,
    ImageQuery,
    Ordering,
    UavImageMetadata,
    UavVideoMetadata,
)
from .models import Image, Raster, Video

_SQL_CONNECTION_TIMEOUT = timedelta(minutes=30)
"""
The SQL server has a habit of terminating connections when they go too
long with no activity, and, despite several attempts to fix this bug,
`aiomysql` still doesn't handle this properly. As a workaround, we manually
refresh the session when it goes unused for a certain amount of time. This
variable specifies what that refresh period is, in seconds.
"""


@time_expiring_cache(_SQL_CONNECTION_TIMEOUT)
def _create_session_maker(db_url: str) -> sessionmaker:
    """
    Creates the `sessionmaker` for a particular database.

    Args:
        db_url: The URL of the database.

    Returns:
        The appropriate session-maker.

    """
    engine = create_async_engine(db_url, echo_pool=True)
    return sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


class SqlRasterMetadataStore(RasterMetadataStore, Generic[MetadataTypeVar]):
    """
    A metadata store for rasters that interfaces with a SQL database.
    """

    @classmethod
    @asynccontextmanager
    async def from_config(
        cls: RasterMetadataStore.ClassType, config: ConfigView
    ) -> AsyncIterator[RasterMetadataStore.ClassType]:
        # Extract the configuration.
        db_url = config["endpoint_url"].as_str()

        logger.info("Connecting to SQL database at {}.", db_url)

        # Create the session.
        session_maker = _create_session_maker(db_url)
        async with session_maker() as session:
            yield cls(session)

    def __init__(
        self,
        session: AsyncSession,
        *,
        model_type: Type[Raster],
        pydantic_type: Type[MetadataTypeVar],
    ):
        """
        Args:
            session: The session to use for communicating with the database.
            model_type: The model type used by the database.
            pydantic_type: Corresponding `pydantic` type for this model type.

        """
        self.__unsafe_session = session
        self.__model_type = model_type
        self.__pydantic_type = pydantic_type

        # Manages access to the raw session between concurrent tasks.
        self.__session_lock = asyncio.Lock()

        # Maps orderings to corresponding columns in the ORM.
        self.__order_to_column = {
            Ordering.Field.NAME: self.__model_type.name,
            Ordering.Field.SESSION: self.__model_type.session_name,
            Ordering.Field.SEQUENCE_NUM: self.__model_type.sequence_number,
            Ordering.Field.CAPTURE_DATE: self.__model_type.capture_date,
            Ordering.Field.CAMERA: self.__model_type.camera,
        }

    @asynccontextmanager
    async def __session_begin(self) -> AsyncIterator[AsyncSession]:
        """
        A substitute for `session.begin()` meant to ensure that two
        co-routines don't use the same session at once.

        Examples:
            ```
            with self.__session_begin() as session:
                query = select(Image)
                session.execute(query)
            ```

        Yields:
            The session that we should use.

        """
        # In the future, we can potentially replace this with some
        # fancy-pants session pool system, but for now, just locking access
        # to a single session is probably fine.
        async with self.__session_lock, self.__unsafe_session.begin():
            yield self.__unsafe_session

    def __orm_model_to_pydantic(self, image: Image) -> MetadataTypeVar:
        """
        Converts an ORM model to a Pydantic model.

        Args:
            image: The image model to convert.

        Returns:
            The converted model.

        """
        metadata = self.__pydantic_type.from_orm(image)

        # Set the location correctly.
        location = GeoPoint(
            latitude_deg=image.location_lat, longitude_deg=image.location_lon
        )
        return metadata.copy(update=dict(location=location))

    def __pydantic_to_orm_image(
        self, object_id: ObjectRef, metadata: MetadataTypeVar
    ) -> Raster:
        """
        Converts a Pydantic metadata model to an ORM model.

        Args:
            object_id: The corresponding reference to the image in the object
                store.
            metadata: The Pydantic model to convert.

        Returns:
            The converted model.

        """
        # Convert to the format used by the database.
        model_attributes = metadata.dict(exclude={"location"})
        # Convert location format.
        location_lat = metadata.location.latitude_deg
        location_lon = metadata.location.longitude_deg

        return self.__model_type(
            bucket=object_id.bucket,
            key=object_id.name,
            location_lat=location_lat,
            location_lon=location_lon,
            **model_attributes,
        )

    async def __get_by_id(
        self, object_id: ObjectRef, *, session: AsyncSession
    ) -> Raster:
        """
        Gets a particular image from the database by its unique ID.

        Args:
            object_id: The unique ID of the image.
            session: The session to use for querying.

        Returns:
            The ORM image that it retrieved.

        Raises:
            - `KeyError` if no such image exists.

        """
        query = select(self.__model_type).where(
            self.__model_type.bucket == object_id.bucket,
            self.__model_type.key == object_id.name,
        )
        query_results = await session.execute(query)

        try:
            return query_results.scalar_one()
        except NoResultFound:
            raise KeyError(f"No metadata for raster '{object_id}'.")

    # TODO (danielp): These should be classmethods, but Python issue 39679
    #  prevents this.
    @singledispatchmethod
    def __update_query(
        self,
        value: Any,
        *,
        query: Select,
        column: InstrumentedAttribute,
    ) -> Select:
        """
        Updates a query to filter for user-specified conditions. For instance,
        a raw int will cause it to generate a query that looks for exact
        equality to that value.

        Args:
            value: The value that we want to filter the query with.
            query: The existing query to add to.
            column: The specific column that we are filtering on.

        Returns:
            The modified query.

        """
        raise NotImplementedError(
            f"__update_query is not implemented for type {type(value)}."
        )

    @__update_query.register
    def _(
        self,
        value: type(None),
        *,
        query: Select,
        column: InstrumentedAttribute,
    ) -> Select:
        # Not specified in the query. Don't add a filter for this.
        return query

    @__update_query.register
    def _(
        self,
        value: str,
        *,
        query: Select,
        column: InstrumentedAttribute,
    ) -> Select:
        return query.where(column.contains(value))

    @__update_query.register
    def _(
        self,
        value: ImageQuery.Range,
        *,
        query: Select,
        column: InstrumentedAttribute,
    ) -> Select:
        if value.min_value is not None:
            query = query.where(column >= value.min_value)
        if value.max_value is not None:
            query = query.where(column <= value.max_value)
        return query

    @staticmethod
    def __update_location_query(
        value: Optional[ImageQuery.BoundingBox],
        *,
        query: Select,
        lat_column: InstrumentedAttribute,
        lon_column: InstrumentedAttribute,
    ) -> Select:
        """
        Updates a query to filter for a specified location.

        Args:
            value: The bounding box around the location.
            query: The query to update.
            lat_column: The column containing the location latitude.
            lon_column: The column containing the location longitude.

        Returns:
            The updated query.

        """
        if value is None:
            # No bounding box was specified, so this doesn't need updating.
            return query

        return query.where(
            lat_column <= value.north_east.latitude_deg,
            lat_column >= value.south_west.latitude_deg,
            lon_column <= value.north_east.longitude_deg,
            lon_column >= value.south_west.longitude_deg,
        )

    def __update_raster_query(
        self,
        value: ImageQuery,
        *,
        query: Select,
    ) -> Select:
        # Shortcut for applying a selection of filters to a query.
        def _apply_query_updates(
            updates: Iterable[Tuple[Any, InstrumentedAttribute]]
        ) -> Select:
            _query = query
            for _value, column in updates:
                _query = self.__update_query(
                    _value, column=column, query=_query
                )
            return _query

        # Build the complete query.
        query = _apply_query_updates(
            [
                (value.platform_type, self.__model_type.platform_type),
                (value.name, self.__model_type.name),
                (value.notes, self.__model_type.notes),
                (value.camera, self.__model_type.camera),
                (value.session, self.__model_type.session_name),
                (value.sequence_numbers, self.__model_type.sequence_number),
                (value.capture_dates, self.__model_type.capture_date),
                (
                    value.location_description,
                    self.__model_type.location_description,
                ),
                (value.altitude_meters, self.__model_type.altitude_meters),
                (value.gsd_cm_px, self.__model_type.gsd_cm_px),
            ]
        )
        query = self.__update_location_query(
            value.bounding_box,
            query=query,
            lat_column=self.__model_type.location_lat,
            lon_column=self.__model_type.location_lon,
        )

        return query

    def __update_query_order(
        self, order: Ordering, *, query: Select
    ) -> Select:
        """
        Updates a query with the specified ordering.

        Args:
            order: The ordering to use.
            query: The query to update.

        Returns:
            The updated query.

        """
        column_spec = self.__order_to_column[order.field]
        if not order.ascending:
            # It should be in descending order.
            column_spec = column_spec.desc()

        return query.order_by(column_spec)

    async def add(
        self,
        *,
        object_id: ObjectRef,
        metadata: MetadataTypeVar,
        overwrite: bool = False,
    ) -> None:
        logger.debug("Adding metadata for object {}.", object_id)

        # Add the new image.
        image = self.__pydantic_to_orm_image(object_id, metadata)
        async with self.__session_begin() as session:
            if overwrite:
                await session.merge(image)
            else:
                session.add(image)

    async def get(self, object_id: ObjectRef) -> MetadataTypeVar:
        async with self.__session_begin() as session:
            model = await self.__get_by_id(object_id, session=session)

        return self.__orm_model_to_pydantic(model)

    async def delete(self, object_id: ObjectRef) -> None:
        logger.debug("Deleting metadata for object {}.", object_id)

        deletion = delete(Image).where(
            self.__model_type.bucket == object_id.bucket,
            self.__model_type.key == object_id.name,
        )
        async with self.__session_begin() as session:
            await session.execute(deletion)

    async def query(
        self,
        queries: Iterable[ImageQuery],
        orderings: Iterable[Ordering] = (),
        skip_first: int = 0,
        max_num_results: int = 500,
    ) -> AsyncIterable[ObjectRef]:
        # Create the SQL query.
        selections = []
        for query in queries:
            selection = select(self.__model_type)
            selections.append(
                self.__update_raster_query(query, query=selection)
            )
        if len(selections) == 0:
            # No queries at all.
            return
        # Get the union of the results.
        last_selection = selections.pop()
        selection = last_selection.union(*selections)

        # Apply the specified orderings.
        for order in orderings:
            selection = self.__update_query_order(order, query=selection)

        # Apply skipping and limiting.
        selection = selection.offset(skip_first).limit(max_num_results)

        # Execute the query.
        async with self.__session_begin() as session:
            query_results = await session.execute(selection)

        for result in query_results.all():
            yield ObjectRef(bucket=result.bucket, name=result.key)


class SqlImageMetadataStore(SqlRasterMetadataStore[UavImageMetadata]):
    """
    A metadata store that stores image metadata in a SQL database.
    """

    def __init__(self, *args: Any, **kwargs: Any):
        """
        Args:
            *args: Will be forwarded to the superclass.
            **kwargs: Will be forwarded to the superclass.

        """
        super().__init__(
            *args, model_type=Image, pydantic_type=UavImageMetadata, **kwargs
        )


class SqlVideoMetadataStore(SqlRasterMetadataStore[UavVideoMetadata]):
    """
    A metadata store that stores image metadata in a SQL database.
    """

    def __init__(self, *args: Any, **kwargs: Any):
        """
        Args:
            *args: Will be forwarded to the superclass.
            **kwargs: Will be forwarded to the superclass.

        """
        super().__init__(
            *args, model_type=Video, pydantic_type=UavVideoMetadata, **kwargs
        )
