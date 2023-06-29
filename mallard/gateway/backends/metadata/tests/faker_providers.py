"""
Contains custom `Faker` providers.
"""


from enum import Enum
from math import ceil
from typing import Any, Dict, Optional, Type

from faker import Faker
from faker.providers import BaseProvider

from mallard.gateway.backends.metadata.schemas import (
    GeoPoint,
    ImageFormat,
    ImageQuery,
    Metadata,
    PlatformType,
    RasterMetadata,
    UavImageMetadata,
    UavVideoMetadata,
    VideoFormat,
)
from mallard.gateway.backends.metadata.sql.models import (
    Artifact,
    Image,
    Raster,
    Video,
)
from mallard.gateway.backends.objects.models import ObjectRef, ObjectType


class MetadataProvider(BaseProvider):
    """
    Faker provider for faking data used by metadata stores.
    """

    def __init__(self, *args: Any, **kwargs: Any):
        super().__init__(*args, **kwargs)

        self.__faker = Faker()
        # Maps object types to their corresponding provider methods.
        self.__object_type_to_metadata = {
            ObjectType.IMAGE: self.image_metadata,
            ObjectType.VIDEO: self.video_metadata,
        }

    def __random_enum(self, enum_type: Type[Enum]) -> Enum:
        """
        Chooses a random value from an enum.

        Args:
            enum_type: The enum type.

        Returns:
            The enum value.

        """
        return self.random_element(list(enum_type))

    def __raster_metadata_common(self) -> Dict[str, Any]:
        """
        Generates values for common parameters of all `RasterMetadata`
        subclasses.

        Returns:
            Dictionary of common parameters that can be passed to the model
            constructor as kwargs.

        """
        return dict(
            name=self.__faker.file_name(category="image"),
            platform_type=self.__random_enum(PlatformType),
            notes=self.__faker.sentence(),
            session_name=self.__faker.word(),
            sequence_number=self.random_int(),
            capture_date=self.__faker.date_object(),
            camera=self.__faker.word(),
            location=self.geo_point(),
            location_description=self.__faker.sentence(),
        )

    def geo_point(
        self,
        allow_none: bool = True,
        min_latitude: float = -90.0,
        min_longitude: float = -180.0,
    ) -> GeoPoint:
        """
        Creates a fake `GeoPoint` instance.

        Args:
            allow_none: If true, will allow the values to be None.
            min_latitude: Minimum value to select for the latitude.
            min_longitude: Minimum value to select for the longitude.

        Returns:
            The `GeoPoint` that it created.

        """
        if allow_none and self.__faker.pybool():
            # Use none values.
            return GeoPoint()

        latitude_diff = float(self.__faker.latitude()) - -90
        longitude_diff = float(self.__faker.longitude()) - -180

        # Respect the minimum constraints.
        missing_latitude_range = (min_latitude - -90) / 180
        missing_longitude_range = (min_longitude - -180) / 360
        latitude_diff = min_latitude + latitude_diff * (
            1 - missing_latitude_range
        )
        longitude_diff = min_longitude + longitude_diff * (
            1 - missing_longitude_range
        )

        return GeoPoint(
            latitude_deg=latitude_diff,
            longitude_deg=longitude_diff,
        )

    def image_metadata(self, uav: bool = True) -> UavImageMetadata:
        """
        Creates a fake `UavImageMetadata` instance.

        Args:
            uav: Whether to include UAV data.

        Returns:
            The `UavImageMetadata` that it created.

        """
        fields = self.__raster_metadata_common()
        if uav:
            fields["altitude_meters"] = self.__faker.pyfloat(
                positive=True, max_value=100
            )
            fields["gsd_cm_px"] = self.__faker.pyfloat(
                positive=True, max_value=10
            )

        return UavImageMetadata(
            format=self.__random_enum(ImageFormat),
            **fields,
        )

    def video_metadata(self, uav: bool = True) -> UavImageMetadata:
        """
        Creates a fake `UavVideoMetadata` instance.

        Args:
            uav: Whether to include UAV data.

        Returns:
            The `UavVideoMetadata` that it created.

        """
        fields = self.__raster_metadata_common()
        if uav:
            fields["altitude_meters"] = self.__faker.pyfloat(
                positive=True, max_value=100
            )
            fields["gsd_cm_px"] = self.__faker.pyfloat(
                positive=True, max_value=10
            )

        return UavVideoMetadata(
            format=self.__random_enum(VideoFormat),
            **fields,
        )

    def image_model(
        self,
        *,
        object_id: ObjectRef,
        source_meta: Optional[UavImageMetadata] = None,
    ) -> Image:
        """
        Creates a fake Image ORM model.

        Args:
            object_id: The object reference to use for populating the model.
            source_meta: The source data to use for populating the model. Will
                be randomly generated if not provided.

        Returns:
            The `Image` that it created.

        """
        if source_meta is None:
            source_meta = self.image_metadata()

        model_attributes = source_meta.dict(include=Image.pydantic_fields())

        return Image(
            bucket=object_id.bucket,
            key=object_id.name,
            **model_attributes,
        )

    def video_model(
        self,
        *,
        object_id: ObjectRef,
        source_meta: Optional[UavVideoMetadata] = None,
    ) -> Video:
        """
        Creates a fake Video ORM model.

        Args:
            object_id: The object reference to use for populating the model.
            source_meta: The source data to use for populating the model. Will
                be randomly generated if not provided.

        Returns:
            The `Video` that it created.

        """
        if source_meta is None:
            source_meta = self.video_metadata()

        model_attributes = source_meta.dict(include=Video.pydantic_fields())

        return Video(
            bucket=object_id.bucket,
            key=object_id.name,
            **model_attributes,
        )

    def raster_model(
        self,
        *,
        object_id: ObjectRef,
        source_meta: Optional[UavImageMetadata | UavVideoMetadata] = None,
        artifact_type: ObjectType = ObjectType.IMAGE,
    ) -> Raster:
        """
        Creates a fake Raster ORM model.

        Args:
            object_id: The object reference to use for populating the model.
            source_meta: The source data to use for populating the model. Will
                be randomly generated if not provided.
            artifact_type: The type of artifact to create a model for.

        Returns:
            The `Raster` that it created.

        """
        if source_meta is None:
            source_meta = self.__object_type_to_metadata[artifact_type]()

        model_attributes = source_meta.dict(include=Raster.pydantic_fields())

        if artifact_type == ObjectType.IMAGE:
            model_attributes["image"] = self.image_model(
                object_id=object_id, source_meta=source_meta
            )
        elif artifact_type == ObjectType.VIDEO:
            model_attributes["video"] = self.video_model(
                object_id=object_id, source_meta=source_meta
            )

        return Raster(
            bucket=object_id.bucket,
            key=object_id.name,
            **model_attributes,
        )

    def artifact_model(
        self,
        *,
        object_id: ObjectRef,
        source_meta: Optional[UavImageMetadata | UavVideoMetadata] = None,
        artifact_type: ObjectType = ObjectType.IMAGE,
    ) -> Artifact:
        """
        Creates a fake Artifact ORM model.

        Args:
            object_id: The object reference to use for populating the model.
            source_meta: The source data to use for populating the model. Will
                be randomly generated if not provided.
            artifact_type: The type of artifact to create a model for.

        Returns:
            The `Artifact` that it created.

        """
        if source_meta is None:
            source_meta = self.__object_type_to_metadata[artifact_type]()

        model_attributes = source_meta.dict(include=Artifact.pydantic_fields())
        # Convert location format.
        location_lat = source_meta.location.latitude_deg
        location_lon = source_meta.location.longitude_deg

        return Artifact(
            bucket=object_id.bucket,
            key=object_id.name,
            raster=self.raster_model(
                object_id=object_id,
                source_meta=source_meta,
                artifact_type=artifact_type,
            ),
            location_lat=location_lat,
            location_lon=location_lon,
            **model_attributes,
        )

    def image_query(self) -> ImageQuery:
        """
        Creates a fake `ImageQuery` instance.

        Returns:
            The `ImageQuery` that it created.

        """
        # Create the fake range values.
        min_sequence_num = self.random_int()
        max_sequence_num = self.random_int(min=min_sequence_num)

        min_capture_date = self.__faker.date_object()
        max_capture_date = self.__faker.date_between_dates(
            date_start=min_capture_date
        )

        min_altitude = self.__faker.pyfloat(min_value=0.0, max_value=400.0)
        max_altitude = self.__faker.pyfloat(
            min_value=ceil(min_altitude), max_value=401.0
        )

        min_gsd = self.__faker.pyfloat(min_value=0.0, max_value=10.0)
        max_gsd = self.__faker.pyfloat(min_value=ceil(min_gsd), max_value=11.0)

        south_west = self.geo_point(allow_none=False)
        north_east = self.geo_point(
            allow_none=False,
            min_latitude=south_west.latitude_deg,
            min_longitude=south_west.longitude_deg,
        )

        return ImageQuery(
            platform_type=self.__random_enum(PlatformType),
            name=self.__faker.file_name(category="image"),
            notes=self.__faker.sentence(),
            camera=self.__faker.word(),
            session=self.__faker.word(),
            sequence_numbers=ImageQuery.Range(
                min_value=min_sequence_num, max_value=max_sequence_num
            ),
            capture_dates=ImageQuery.Range(
                min_value=min_capture_date, max_value=max_capture_date
            ),
            bounding_box=ImageQuery.BoundingBox(
                south_west=south_west, north_east=north_east
            ),
            location_description=self.__faker.sentence(),
            altitude_meters=ImageQuery.Range(
                min_value=min_altitude, max_value=max_altitude
            ),
            gsd_cm_px=ImageQuery.Range(min_value=min_gsd, max_value=max_gsd),
        )
