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
from sqlalchemy.sql.expression import Select, select, union_all

from ...objects.models import ObjectRef, ObjectType, TypedObjectRef
from ...time_expiring_cache import time_expiring_cache
from .. import ArtifactMetadataStore, MetadataTypeVar
from ..schemas import (
    GeoPoint,
    ImageQuery,
    Metadata,
    Ordering,
    RasterMetadata,
    UavImageMetadata,
    UavVideoMetadata,
)
from .models import Artifact, Base, Image, Raster, Video

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


class SqlArtifactMetadataStore(
    ArtifactMetadataStore, Generic[MetadataTypeVar]
):
    """
    A metadata store for artifacts that interfaces with a SQL database.
    """

    @classmethod
    @asynccontextmanager
    async def from_config(
        cls: ArtifactMetadataStore.ClassType, config: ConfigView
    ) -> AsyncIterator[ArtifactMetadataStore.ClassType]:
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
        pydantic_type: Type[MetadataTypeVar] = Metadata,
    ):
        """
        Args:
            session: The session to use for communicating with the database.
            pydantic_type: Pydantic metadata type to use.

        """
        self.__unsafe_session = session
        self.__pydantic_type = pydantic_type

        # Manages access to the raw session between concurrent tasks.
        self.__session_lock = asyncio.Lock()

        # Maps orderings to corresponding columns in the ORM.
        self.__order_to_column = {
            Ordering.Field.NAME: Artifact.name,
            Ordering.Field.SESSION: Artifact.session_name,
            Ordering.Field.SEQUENCE_NUM: Artifact.sequence_number,
            Ordering.Field.CAPTURE_DATE: Artifact.capture_date,
            Ordering.Field.CAMERA: Raster.camera,
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

    def __merge_orm_to_pydantic(self, *orm_models: Base) -> MetadataTypeVar:
        """
        Merges multiple ORM models into a single Pydantic model. This is
        useful because often a single Pydantic model will encompass
        information spread across multiple tables.

        Args:
            *orm_models: The models to merge.

        Returns:
            The equivalent Pydantic model.

        """
        pydantic_fields = {}
        for model in orm_models:
            # Extract the relevant Pydantic fields from each ORM model.
            pydantic_fields.update(
                self.__pydantic_type.from_orm(model).dict(exclude_unset=True)
            )

        return self.__pydantic_type(**pydantic_fields)

    def __orm_model_to_pydantic(self, orm_model: Artifact) -> MetadataTypeVar:
        """
        Converts an ORM model to a Pydantic model.

        Args:
            orm_model: The ORM model to convert.

        Returns:
            The converted model.

        """
        # Extract data from other tables if its present.
        orm_models = [orm_model]
        if orm_model.raster is not None:
            orm_models.append(orm_model.raster)

            if orm_model.raster.image is not None:
                orm_models.append(orm_model.raster.image)
            elif orm_model.raster.video is not None:
                orm_models.append(orm_model.raster.video)
        metadata = self.__merge_orm_to_pydantic(*orm_models)

        # Set the location correctly.
        location = GeoPoint(
            latitude_deg=orm_model.location_lat,
            longitude_deg=orm_model.location_lon,
        )
        return metadata.copy(update=dict(location=location))

    @classmethod
    def _pydantic_to_orm_model(
        cls, object_id: ObjectRef, metadata: Metadata
    ) -> Artifact:
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
        model_attributes = metadata.dict(include=Artifact.pydantic_fields())
        # Convert location format.
        location_lat = metadata.location.latitude_deg
        location_lon = metadata.location.longitude_deg

        return Artifact(
            bucket=object_id.bucket,
            key=object_id.name,
            location_lat=location_lat,
            location_lon=location_lon,
            **model_attributes,
        )

    @staticmethod
    async def __get_by_id(
        object_id: ObjectRef, *, session: AsyncSession
    ) -> Artifact:
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
        query = select(Artifact).where(
            Artifact.bucket == object_id.bucket,
            Artifact.key == object_id.name,
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
                (value.platform_type, Artifact.platform_type),
                (value.name, Artifact.name),
                (value.notes, Artifact.notes),
                (value.camera, Raster.camera),
                (value.session, Artifact.session_name),
                (value.sequence_numbers, Artifact.sequence_number),
                (value.capture_dates, Artifact.capture_date),
                (
                    value.location_description,
                    Artifact.location_description,
                ),
                (value.altitude_meters, Raster.altitude_meters),
                (value.gsd_cm_px, Raster.gsd_cm_px),
            ]
        )
        query = self.__update_location_query(
            value.bounding_box,
            query=query,
            lat_column=Artifact.location_lat,
            lon_column=Artifact.location_lon,
        )
        # We used columns from both the artifact and raster tables,
        # so we have to join them.
        query = query.join_from(
            Artifact,
            Raster,
            onclause=(Artifact.bucket == Raster.bucket)
            & (Artifact.key == Raster.key),
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

    @staticmethod
    def __object_type(model: Artifact) -> ObjectType:
        """
        Determines the type of an object from the ORM model.

        Args:
            model: The model to get the type of.

        Returns:
            The object type.

        """
        if model.raster is not None:
            if model.raster.image is not None:
                return ObjectType.IMAGE
            elif model.raster.video is not None:
                return ObjectType.VIDEO

            return ObjectType.RASTER

        return ObjectType.ARTIFACT

    async def add(
        self,
        *,
        object_id: ObjectRef,
        metadata: MetadataTypeVar,
        overwrite: bool = False,
    ) -> None:
        logger.debug("Adding metadata for object {}.", object_id)

        # Add the new image.
        image = self._pydantic_to_orm_model(object_id, metadata)
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

        async with self.__session_begin() as session:
            artifact = await self.__get_by_id(object_id, session=session)
            await session.delete(artifact)

    async def query(
        self,
        queries: Iterable[ImageQuery],
        orderings: Iterable[Ordering] = (),
        skip_first: int = 0,
        max_num_results: int = 500,
    ) -> AsyncIterable[TypedObjectRef]:
        # Create the SQL query.
        selections = []
        for query in queries:
            selection = select(Artifact)
            selections.append(
                self.__update_raster_query(query, query=selection)
            )
        if len(selections) == 0:
            # No queries at all.
            return
        # Get the union of the results.
        selection = union_all(*selections)

        # Apply the specified orderings.
        for order in orderings:
            selection = self.__update_query_order(order, query=selection)

        # Apply skipping and limiting.
        selection = selection.offset(skip_first).limit(max_num_results)
        # Get ORM objects instead of raw rows.
        selection = select(Artifact).from_statement(selection)

        # Execute the query.
        async with self.__session_begin() as session:
            query_results = await session.execute(selection)

        for result in query_results.scalars():
            object_type = self.__object_type(result)
            yield TypedObjectRef(
                id=ObjectRef(bucket=result.bucket, name=result.key),
                type=object_type,
            )


class SqlRasterMetadataStore(
    SqlArtifactMetadataStore, Generic[MetadataTypeVar]
):
    """
    A metadata store that stores raster metadata in a SQL database.
    """

    def __init__(
        self,
        *args: Any,
        pydantic_type: Type[MetadataTypeVar] = RasterMetadata,
        **kwargs: Any,
    ):
        """
        Args:
            *args: Will be forwarded to the superclass.
            pydantic_type: Pydantic metadata type to use.
            **kwargs: Will be forwarded to the superclass.

        """
        super().__init__(*args, pydantic_type=pydantic_type, **kwargs)

    @classmethod
    def _pydantic_to_orm_model(
        cls, object_id: ObjectRef, metadata: RasterMetadata
    ) -> Artifact:
        artifact = super()._pydantic_to_orm_model(object_id, metadata)

        fields = metadata.dict(include=Raster.pydantic_fields())
        artifact.raster = Raster(
            bucket=object_id.bucket, key=object_id.name, **fields
        )

        return artifact


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
        super().__init__(*args, pydantic_type=UavImageMetadata, **kwargs)

    @classmethod
    def _pydantic_to_orm_model(
        cls, object_id: ObjectRef, metadata: UavImageMetadata
    ) -> Artifact:
        artifact = super()._pydantic_to_orm_model(object_id, metadata)

        fields = metadata.dict(include=Image.pydantic_fields())
        artifact.raster.image = Image(
            bucket=object_id.bucket, key=object_id.name, **fields
        )

        return artifact


class SqlVideoMetadataStore(SqlRasterMetadataStore[UavVideoMetadata]):
    """
    A metadata store that stores video metadata in a SQL database.
    """

    def __init__(self, *args: Any, **kwargs: Any):
        """
        Args:
            *args: Will be forwarded to the superclass.
            **kwargs: Will be forwarded to the superclass.

        """
        super().__init__(*args, pydantic_type=UavVideoMetadata, **kwargs)

    @classmethod
    def _pydantic_to_orm_model(
        cls, object_id: ObjectRef, metadata: UavVideoMetadata
    ) -> Artifact:
        artifact = super()._pydantic_to_orm_model(object_id, metadata)

        fields = metadata.dict(include=Video.pydantic_fields())
        artifact.raster.video = Video(
            bucket=object_id.bucket, key=object_id.name, **fields
        )

        return artifact
