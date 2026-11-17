"""
A metadata store that interfaces with a SQL database.
"""

import hashlib
import json
from contextlib import asynccontextmanager
from datetime import date, datetime
from functools import singledispatchmethod
from typing import (
    Any,
    AsyncIterable,
    AsyncIterator,
    Generic,
    Iterable,
    Tuple,
    Type,
)

from confuse import ConfigView
from loguru import logger
from sqlalchemy import (
    ColumnElement,
    and_,
    case,
    false,
    or_,
    text,
    true,
    tuple_,
)
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm.attributes import InstrumentedAttribute
from sqlalchemy.orm.exc import NoResultFound
from sqlalchemy.sql.expression import Select, select

from ...objects.models import ObjectRef, ObjectType, TypedObjectRef
from .. import ArtifactMetadataStore, MetadataTypeVar
from ..pagination import QueryPage, _decode_cursor, _encode_cursor
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


@asynccontextmanager
async def _create_session_maker(
    db_url: str,
) -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    """Creates a session factory and manages its connection pool's lifetime.

    Args:
        db_url: The URL of the database.

    Yields:
        The session factory bound to the database's shared engine.
    """
    engine = create_async_engine(db_url, echo_pool=True, pool_recycle=3600)
    try:
        yield async_sessionmaker(engine, expire_on_commit=False)
    finally:
        # Dispose pooled connections even when backend initialization fails.
        await engine.dispose()


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

        # Create the shared factory without opening a session at startup.
        async with _create_session_maker(db_url) as session_factory:
            yield cls(session_factory)

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        *,
        pydantic_type: Type[MetadataTypeVar] = Metadata,
        enable_match: bool = True,
    ) -> None:
        """
        Args:
            session_factory: Factory for independent transactional sessions.
            pydantic_type: Pydantic metadata type to use.
            enable_match: Enables the MATCH keyword for full-text search.
                Some databases might not support this.

        """
        # Share the connection pool, not mutable session state, between tasks.
        self.__session_factory = session_factory
        self.__pydantic_type = pydantic_type
        self.__enable_match = enable_match

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
        Creates an independent session and transaction for an operation.

        Examples:
            ```
            async with self.__session_begin() as session:
                query = select(Image)
                await session.execute(query)
            ```

        Yields:
            The session that we should use.

        """
        # The engine's pool reuses connections while sessions remain task-local;
        # the context commits or rolls back and closes the session on exit.
        async with self.__session_factory.begin() as session:
            yield session

    @asynccontextmanager
    async def __write_session_begin(
        self, object_id: ObjectRef
    ) -> AsyncIterator[AsyncSession]:
        """Locks an artifact before reading or modifying its metadata graph.

        Args:
            object_id: The object whose writers must be serialized.

        Yields:
            A transactional session holding the parent lock until exit.
        """
        async with self.__session_begin() as session:
            if session.get_bind().dialect.name == "sqlite":
                # SQLite ignores FOR UPDATE, so reserve its writer before reads.
                await session.execute(text("BEGIN IMMEDIATE"))
            # Lock the parent before any select-in loads establish a snapshot.
            query = (
                select(Artifact.bucket)
                .where(
                    Artifact.bucket == object_id.bucket,
                    Artifact.key == object_id.name,
                )
                .with_for_update()
            )
            await session.execute(query)
            yield session

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
    def __update_query_expression(
        self,
        value: Any,
        *,
        conjunction: ColumnElement = true(),
        column: InstrumentedAttribute,
        **kwargs: Any,
    ) -> ColumnElement:
        """
        Updates a SQL expression to filter for user-specified conditions. For
        instance, a raw int will cause it to generate an expression that looks
        for exact quality to that value.

        Args:
            value: The value that we want to filter with.
            conjunction: The clause that the expression will be ANDed with.
                Can make it easier to build up large expressions.
            column: The specific column that we are filtering on.
            **kwargs: Some overloads of this function might take specific
                keyword arguments.

        Returns:
            The modified query.

        """
        raise NotImplementedError(
            f"__update_query is not implemented for type {type(value)}."
        )

    @__update_query_expression.register
    def _(
        self,
        value: type(None),
        *,
        conjunction: ColumnElement = true(),
        column: InstrumentedAttribute,
        **kwargs: Any,
    ) -> ColumnElement:
        # Not specified in the query. Don't add a filter for this.
        return conjunction

    @__update_query_expression.register
    def _(
        self,
        value: str,
        *,
        conjunction: ColumnElement = true(),
        column: InstrumentedAttribute,
        full_text: bool = False,
    ) -> ColumnElement:
        if not full_text:
            expression = column.startswith(value)
        else:
            # Perform full-text matching.
            if self.__enable_match:
                expression = column.match(value)
            else:
                # MATCH is not supported.
                expression = column.contains(value)
        return conjunction & expression

    @__update_query_expression.register
    def _(
        self,
        value: ImageQuery.Range,
        *,
        conjunction: ColumnElement = true(),
        column: InstrumentedAttribute,
    ) -> ColumnElement:
        expression = conjunction
        if value.min_value is not None:
            expression = expression & (column >= value.min_value)
        if value.max_value is not None:
            expression = expression & (column <= value.max_value)
        return expression

    @staticmethod
    def __update_location_query_expression(
        value: ImageQuery.BoundingBox | None,
        *,
        conjunction: ColumnElement = true(),
        lat_column: InstrumentedAttribute,
        lon_column: InstrumentedAttribute,
    ) -> ColumnElement:
        """
        Updates a query to filter for a specified location.

        Args:
            value: The bounding box around the location.
            conjunction: The clause that the expression will be ANDed with.
                Can make it easier to build up large expressions.
            lat_column: The column containing the location latitude.
            lon_column: The column containing the location longitude.

        Returns:
            The updated query.

        """
        if value is None:
            # No bounding box was specified, so this doesn't need updating.
            return conjunction

        return (
            conjunction
            & (lat_column <= value.north_east.latitude_deg)
            & (lat_column >= value.south_west.latitude_deg)
            & (lon_column <= value.north_east.longitude_deg)
            & (lon_column >= value.south_west.longitude_deg)
        )

    def __update_raster_query_expression(
        self,
        value: ImageQuery,
        *,
        conjunction: ColumnElement = true(),
    ) -> ColumnElement:
        # Shortcut for applying a selection of filters to a query.
        def _apply_expression_updates(
            updates: Iterable[Tuple[Any, InstrumentedAttribute]],
        ) -> Select:
            _expression = conjunction
            for _value, column in updates:
                _expression = self.__update_query_expression(
                    _value, column=column, conjunction=_expression
                )
            return _expression

        # Build the complete query.
        expression = _apply_expression_updates(
            [
                (value.platform_type, Artifact.platform_type),
                (value.name, Artifact.name),
                (value.camera, Raster.camera),
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
        # Add full text queries.
        expression = self.__update_query_expression(
            value.session,
            column=Artifact.session_name,
            conjunction=expression,
            full_text=True,
        )
        expression = self.__update_query_expression(
            value.notes,
            column=Artifact.notes,
            conjunction=expression,
            full_text=True,
        )
        # Add location queries.
        expression = self.__update_location_query_expression(
            value.bounding_box,
            conjunction=expression,
            lat_column=Artifact.location_lat,
            lon_column=Artifact.location_lon,
        )

        return expression

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

        # Currently, we never actually take this path. This might need
        # reconsideration later if we add new types of artifacts, though.
        return ObjectType.ARTIFACT  # pragma: no cover

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
        transaction = (
            self.__write_session_begin(object_id)
            if overwrite
            else self.__session_begin()
        )
        async with transaction as session:
            if overwrite:
                await session.merge(image)
            else:
                session.add(image)

    async def get(self, object_id: ObjectRef) -> MetadataTypeVar:
        async with self.__session_begin() as session:
            model = await self.__get_by_id(object_id, session=session)
            return self.__orm_model_to_pydantic(model)

    async def update(
        self,
        *,
        object_id: ObjectRef,
        metadata: MetadataTypeVar,
        merge: bool = True,
    ) -> None:
        """Updates metadata, keeping a merged read and write atomic.

        Args:
            object_id: The object whose metadata should be updated.
            metadata: The new metadata to merge or replace.
            merge: Whether non-None fields should override existing values.

        Raises:
            KeyError: If merging metadata for an object that does not exist.
        """
        if not merge:
            # Preserve replacement's existing upsert behavior without merging fields.
            await self.add(
                object_id=object_id, metadata=metadata, overwrite=True
            )
            return

        async with self.__write_session_begin(object_id) as session:
            old_model = await self.__get_by_id(object_id, session=session)
            merged_metadata = self._merge_metadata(
                object_id=object_id,
                old_metadata=self.__orm_model_to_pydantic(old_model),
                metadata=metadata,
            )
            # All artifact, raster, and subtype writes share the locked transaction.
            await session.merge(
                self._pydantic_to_orm_model(object_id, merged_metadata)
            )

    async def delete(self, object_id: ObjectRef) -> None:
        logger.debug("Deleting metadata for object {}.", object_id)

        async with self.__write_session_begin(object_id) as session:
            artifact = await self.__get_by_id(object_id, session=session)
            await session.delete(artifact)

    @staticmethod
    def __cursor_value(
        value: str | int | None, column: InstrumentedAttribute
    ) -> str | int | date | datetime | None:
        """Validates a cursor value's type and portable parameter-binding bounds.

        Args:
            value: Untrusted decoded ordering value.
            column: Column whose type and nullability constrain the value.

        Returns:
            A value suitable for a bound SQL comparison.

        Raises:
            ValueError: If the value has the wrong type or exceeds binding bounds.
        """
        if value is None:
            if not column.nullable:
                raise ValueError("Cursor identity values cannot be null.")
            return None
        python_type = column.type.python_type
        if python_type in (date, datetime):
            if type(value) is not str:
                raise ValueError("Invalid cursor date value.")
            try:
                # ISO round trips preserve datetime precision and UTC offsets.
                parsed = python_type.fromisoformat(value)
            except ValueError as error:
                raise ValueError("Invalid cursor date value.") from error
            if parsed.isoformat() != value:
                raise ValueError("Cursor dates must use canonical ISO format.")
            return parsed
        if type(value) is not python_type:
            raise ValueError("Invalid cursor ordering value type.")
        # Token bounds limit strings; SQLite need not enforce declared widths.
        if type(value) is int and not -(2**63) <= value < 2**63:
            raise ValueError(
                "Cursor integer exceeds the signed 64-bit binding range."
            )
        return value

    @staticmethod
    async def __query_page_types(
        session: AsyncSession, identities: list[tuple[str, str]]
    ) -> dict[tuple[str, str], ObjectType]:
        """Fetches subtypes for selected identities in bounded SQL batches.

        Args:
            session: Transaction used to select the cursor page.
            identities: Artifact identities from the limited page selection.

        Returns:
            Types for identities whose raster rows are still visible.
        """
        object_types = {}
        # Two parameters per identity stay below even older SQLite bind limits.
        for start in range(0, len(identities), 400):
            selection = (
                select(
                    Raster.bucket,
                    Raster.key,
                    Image.bucket.label("image_bucket"),
                    Video.bucket.label("video_bucket"),
                )
                .outerjoin(
                    Image,
                    (Raster.bucket == Image.bucket)
                    & (Raster.key == Image.key),
                )
                .outerjoin(
                    Video,
                    (Raster.bucket == Video.bucket)
                    & (Raster.key == Video.key),
                )
                .where(
                    tuple_(Raster.bucket, Raster.key).in_(
                        identities[start : start + 400]
                    )
                )
            )
            for row in (await session.execute(selection)).all():
                object_types[(row.bucket, row.key)] = (
                    ObjectType.IMAGE
                    if row.image_bucket is not None
                    else (
                        ObjectType.VIDEO
                        if row.video_bucket is not None
                        else ObjectType.RASTER
                    )
                )
        return object_types

    async def query_page(
        self,
        queries: Iterable[ImageQuery],
        orderings: Iterable[Ordering] = (),
        *,
        cursor: str | None = None,
        max_num_results: int = 500,
    ) -> QueryPage:
        """Returns a SQL keyset page, with NULL values last in either direction.

        Args:
            queries: Disjunctive filters, with fields within each filter ANDed.
            orderings: Ordered sort specifications, followed by bucket and key.
            cursor: None for the first page, otherwise a prior continuation.
            max_num_results: Positive maximum number of references to return.

        Returns:
            References and a continuation only when another result exists.

        Raises:
            ValueError: If the limit or cursor is invalid or mismatched.
            NotImplementedError: If a filter or ordering is unsupported.
        """
        if type(max_num_results) is not int or not 0 < max_num_results < 2**31:
            raise ValueError("Page size must be a positive SQL integer.")
        queries = list(queries)
        orderings = list(orderings)
        fingerprint = hashlib.sha256(
            json.dumps(
                {
                    "queries": [q.model_dump(mode="json") for q in queries],
                    "orderings": [
                        o.model_dump(mode="json") for o in orderings
                    ],
                    "match": self.__enable_match,
                },
                sort_keys=True,
                separators=(",", ":"),
                allow_nan=False,
            ).encode("utf-8")
        ).hexdigest()
        columns = []
        directions = []
        for order in orderings:
            if order.field not in self.__order_to_column:
                raise NotImplementedError("Unsupported cursor ordering.")
            columns.append(self.__order_to_column[order.field])
            directions.append(order.ascending)
        # Identity columns make all ties deterministic across page boundaries.
        columns.extend([Artifact.bucket, Artifact.key])
        directions.extend([True, True])
        values = None
        if cursor is not None:
            raw_values = _decode_cursor(cursor, fingerprint)
            if len(raw_values) != len(columns):
                raise ValueError("Cursor ordering value count does not match.")
            values = [
                self.__cursor_value(value, column)
                for value, column in zip(raw_values, columns)
            ]

        expressions = [
            self.__update_raster_query_expression(query) for query in queries
        ]
        selection = (
            # A covering page projection avoids full-row scans chosen by MariaDB.
            select(Artifact.bucket, Artifact.key, *columns)
            .join_from(
                Artifact,
                Raster,
                onclause=(Artifact.bucket == Raster.bucket)
                & (Artifact.key == Raster.key),
            )
            .where(or_(*expressions) if expressions else true())
        )
        null_ranks = {
            "capture_date": Artifact.capture_date_is_null,
            "session_name": Artifact.session_name_is_null,
            "name": Artifact.name_is_null,
        }
        after = false()
        equal_prefix = true()
        constant_null_prefix = values is not None
        for index, (column, ascending) in enumerate(zip(columns, directions)):
            value = values[index] if values is not None else None
            constant_null = constant_null_prefix and value is None
            if value is not None:
                constant_null_prefix = False
            null_rank = None
            if column.nullable:
                # MariaDB needs the generated column named explicitly to use its index.
                null_rank = null_ranks.get(column.key)
                if null_rank is None:
                    # Less common orderings retain portable null-last behavior.
                    null_rank = case((column.is_(None), 1), else_=0)
                if not constant_null:
                    selection = selection.order_by(null_rank.asc())
            # A leading NULL cursor prefix is fixed by WHERE; sorting it confuses MariaDB.
            if not constant_null:
                # Keep nonnullable identity ordering eligible for ordinary indexes.
                selection = selection.order_by(
                    column.asc() if ascending else column.desc()
                )
            if values is not None:
                if null_rank is not None:
                    rank_value = 1 if value is None else 0
                    if value is not None:
                        # Seek in the same ranked key order used by the composite index.
                        after = or_(
                            after, and_(equal_prefix, null_rank > rank_value)
                        )
                    equal_prefix = and_(equal_prefix, null_rank == rank_value)
                if value is None:
                    equal_prefix = and_(equal_prefix, column.is_(None))
                else:
                    comparison = (
                        column > value if ascending else column < value
                    )
                    after = or_(after, and_(equal_prefix, comparison))
                    equal_prefix = and_(equal_prefix, column == value)
        if values is not None:
            selection = selection.where(after)
        # The extra row distinguishes exact-size final pages without a count.
        selection = selection.limit(max_num_results + 1)
        async with self.__session_begin() as session:
            rows = (await session.execute(selection)).all()
            page_rows = rows[:max_num_results]
            # Determine subtype only for this bounded page, not the whole result set.
            object_types = await self.__query_page_types(
                session, [(row[0], row[1]) for row in page_rows]
            )
            image_ids = [
                TypedObjectRef(
                    id=ObjectRef(bucket=row[0], name=row[1]),
                    type=object_types[(row[0], row[1])],
                )
                for row in page_rows
                # READ COMMITTED and SQLite may expose deletions between the two reads.
                if (row[0], row[1]) in object_types
            ]
            next_cursor = None
            if len(rows) > max_num_results:
                # Capture selected values, never look up the anchor on resume.
                last_values = [
                    value.isoformat() if isinstance(value, date) else value
                    for value in page_rows[-1][2:]
                ]
                next_cursor = _encode_cursor(fingerprint, last_values)
        return QueryPage(image_ids=image_ids, next_cursor=next_cursor)

    async def query(
        self,
        queries: Iterable[ImageQuery],
        orderings: Iterable[Ordering] = (),
        skip_first: int = 0,
        max_num_results: int = 500,
    ) -> AsyncIterable[TypedObjectRef]:
        # Create the SQL query.
        expressions = []
        for query in queries:
            expression = true()
            expressions.append(
                self.__update_raster_query_expression(
                    query, conjunction=expression
                )
            )
        # Get the disjunction of the results.
        disjunction = or_(*expressions)

        # Build a query for anything that matches.
        selection = select(Artifact).where(disjunction)
        # We used columns from both the artifact and raster tables,
        # so we have to join them.
        selection = selection.join_from(
            Artifact,
            Raster,
            onclause=(Artifact.bucket == Raster.bucket)
            & (Artifact.key == Raster.key),
        )

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
            # Detach plain references before yielding to a potentially slow caller.
            results = [
                TypedObjectRef(
                    id=ObjectRef(bucket=result.bucket, name=result.key),
                    type=self.__object_type(result),
                )
                for result in query_results.scalars()
            ]

        for result in results:
            yield result


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
