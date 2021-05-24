"""
An `ImageMetadataStore` that uses the iRODS metadata feature as a backend.
"""


from datetime import date, datetime, time
from enum import Enum
from functools import singledispatchmethod
from pathlib import Path
from typing import Any, AsyncIterable, Iterable

from irods.column import Between, Criterion, Like
from irods.models import Collection, DataObject, DataObjectMeta
from irods.query import Query

from mallard.gateway.async_utils import make_async_iter

from ..objects.models import ObjectRef
from .image_metadata_store import ImageMetadataStore
from .irods_metadata_helpers import to_irods_string
from .irods_metadata_store import IrodsMetadataStore
from .schemas import (
    GeoPoint,
    ImageMetadata,
    ImageQuery,
    Ordering,
    UavImageMetadata,
)


class IrodsImageMetadataStore(IrodsMetadataStore, ImageMetadataStore):
    """
    An `ImageMetadataStore` that uses the iRODS metadata feature as a backend.
    """

    _QUERY_TO_META_FIELDS = {
        "platform_type": "platform_type",
        "name": "name",
        "notes": "notes",
        "camera": "camera",
        "session_numbers": "session_number",
        "sequence_numbers": "sequence_number",
        "capture_dates": "capture_date",
        "bounding_box": "location",
        "location_description": "location_description",
        "altitude_meters": "altitude_meters",
        "gsd_cm_px": "gsd_cm_px",
    }
    """
    Mapping of fields in the `ImageQuery` structure to corresponding fields
    that will be searched in the `UavImageMetadata` structure.
    """

    @staticmethod
    def __name_criterion(name: str) -> Criterion:
        """
        Creates the criterion for selecting a metadata attribute with a
        particular name.

        Args:
            name: The name of the attribute.

        Returns:
            The corresponding criterion.

        """
        return Criterion("=", DataObjectMeta.name, name)

    # TODO (danielp): These should be classmethods, but Python issue 39679
    #  prevents this.
    @singledispatchmethod
    def __build_query(self, value: Any, name: str, query: Query) -> Query:
        """
        Updates a query to filter for user-specified conditions. For instance,
        a raw int or string will cause it to generate a query that looks for
        exact equality to that value.

        Args:
            value: The query value.
            name: The name of the metadata attribute that we are querying,
                or the name prefix if this query involves multiple attributes.
            query: The existing query to add to.

        Returns:
            The modified query.

        """
        raise NotImplementedError(
            f"__update_query is not implemented for type {type(value)}."
        )

    @__build_query.register
    def _(self, value: type(None), name: str, query: Query) -> Query:
        # Not specified; don't add a constraint for this.
        return query

    @__build_query.register
    def _(self, value: str, name: str, query: Query) -> Query:
        # Pattern match string.
        pattern = f"%{value}%"

        return query.filter(
            self.__name_criterion(name),
            Like(DataObjectMeta.value, to_irods_string(pattern)),
        )

    @__build_query.register
    def _(self, value: Enum, name: str, query: Query) -> Query:
        # Search for the enum by value.
        return self.__build_query(value.value, name, query)

    @__build_query.register
    def _(
        self, value: ImageQuery.Range[date], name: str, query: Query
    ) -> Query:
        # Convert to a full datetime.
        min_time = datetime.combine(value.min_value, time(0, 0, 0))
        max_time = datetime.combine(value.max_value, time(23, 59, 59))

        min_time = to_irods_string(min_time)
        max_time = to_irods_string(max_time)

        return query.filter(
            self.__name_criterion(name),
            Between(DataObjectMeta.value, (min_time, max_time)),
        )

    @__build_query.register
    def _(self, value: ImageQuery.Range, name: str, query: Query) -> Query:
        # Standard numeric range.
        return query.filter(
            self.__name_criterion(name),
            Between(
                DataObjectMeta.value,
                (
                    to_irods_string(value.min_value),
                    to_irods_string(value.max_value),
                ),
            ),
        )

    @__build_query.register
    def _(
        self, value: ImageQuery.BoundingBox, name: str, query: Query
    ) -> Query:
        # Compute the correct names for each of the sub-attributes.
        assert (
            "latitude_deg" in GeoPoint.__fields__
        ), "latitude_deg field missing."
        assert (
            "longitude_deg" in GeoPoint.__fields__
        ), "longitude_deg field missing."
        lat_deg_key = self._combine_keys(name, "latitude_deg")
        lon_deg_key = self._combine_keys(name, "longitude_deg")

        return query.filter(
            self.__name_criterion(lat_deg_key),
            Between(
                DataObjectMeta.value,
                (
                    to_irods_string(value.south_west.latitude_deg),
                    to_irods_string(value.north_east.latitude_deg),
                ),
            ),
        ).filter(
            self.__name_criterion(lon_deg_key),
            Between(
                DataObjectMeta.value,
                (
                    to_irods_string(value.south_west.longitude_deg),
                    to_irods_string(value.north_east.longitude_deg),
                ),
            ),
        )

    @__build_query.register
    def _(self, value: ImageQuery, name: str, query: Query) -> Query:
        for field_name in value.dict().keys():
            # Determine the metadata key in iRODS.
            metadata_key = self._QUERY_TO_META_FIELDS[field_name]
            metadata_key = self._combine_keys(name, metadata_key)

            field_value = getattr(value, field_name)

            # Build a query for that key.
            query = self.__build_query(field_value, metadata_key, query)

        return query

    def __make_default_query(self) -> Query:
        """
        Creates the default query, which selects all items that we have
        access to.

        Returns:
            The query that it created.

        """
        sql_query = self._session.query(DataObject.name, Collection.name)

        # Initially filter on the root collection to exclude results that
        # aren't relevant to the application.
        root_pattern = f"{self._root_path.as_posix()}%"
        sql_query = sql_query.filter(Like(Collection.name, root_pattern))

        # Also filter out thumbnails.
        return sql_query.filter(
            Criterion("not like", DataObject.name, "%.thumbnail")
        )

    async def get(self, object_id: ObjectRef) -> ImageMetadata:
        return await self._get(object_id, parse_as=ImageMetadata)

    async def query(
        self,
        query: ImageQuery,
        orderings: Iterable[Ordering] = (),
        skip_first: int = 0,
        max_num_results: int = 500,
    ) -> AsyncIterable[ObjectRef]:
        # Translate this into an actual SQL query.
        sql_query = self.__make_default_query()
        sql_query = self.__build_query(query, "", sql_query)

        # Apply the limit and offset.
        sql_query = sql_query.offset(skip_first)
        sql_query = sql_query.limit(max_num_results)
        # TODO (danielp) Support ordering in some capacity.

        # Get the results asynchronously.
        query_results = make_async_iter(sql_query)
        async for result in query_results:
            # Remove the root path from the bucket.
            bucket = Path(result[Collection.name])
            bucket = bucket.relative_to(self._root_path)

            yield ObjectRef(
                bucket=bucket.as_posix(),
                name=result[DataObject.name],
            )


class IrodsUavImageMetadataStore(IrodsImageMetadataStore):
    """
    An `ImageMetadataStore` for UAV data that uses iRODS as a backend.
    """

    async def get(self, object_id: ObjectRef) -> UavImageMetadata:
        return await self._get(object_id, parse_as=UavImageMetadata)
