"""
Contains custom `Faker` providers.
"""


from enum import Enum
from math import ceil
from typing import Any, Dict, Type

from faker import Faker
from faker.providers import BaseProvider

from mallard.gateway.backends.metadata.schemas import (
    GeoPoint,
    ImageFormat,
    ImageMetadata,
    ImageQuery,
    PlatformType,
    UavImageMetadata,
)


class MetadataProvider(BaseProvider):
    """
    Faker provider for faking data used by metadata stores.
    """

    def __init__(self, *args: Any, **kwargs: Any):
        super().__init__(*args, **kwargs)

        self.__faker = Faker()

    def __random_enum(self, enum_type: Type[Enum]) -> Enum:
        """
        Chooses a random value from an enum.

        Args:
            enum_type: The enum type.

        Returns:
            The enum value.

        """
        return self.random_element(list(enum_type))

    def __image_metadata_common(self) -> Dict[str, Any]:
        """
        Generates values for common parameters of all `ImageMetadata`
        subclasses.

        Returns:
            Dictionary of common parameters that can be passed to the model
            constructor as kwargs.

        """
        return dict(
            name=self.__faker.file_name(category="image"),
            format=self.__random_enum(ImageFormat),
            platform_type=self.__random_enum(PlatformType),
            notes=self.__faker.sentence(),
            session_number=self.random_int(),
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

    def image_metadata(self) -> ImageMetadata:
        """
        Creates a fake `ImageMetadata` instance.

        Returns:
            The `ImageMetadata` that it created.

        """
        return ImageMetadata(**self.__image_metadata_common())

    def uav_image_metadata(self) -> UavImageMetadata:
        """
        Creates a fake `UavImageMetadata` instance.

        Returns:
            The `UavImageMetadata` that it created.

        """
        return UavImageMetadata(
            **self.__image_metadata_common(),
            altitude_meters=self.__faker.pyfloat(positive=True, max_value=100),
            gsd_cm_px=self.__faker.pyfloat(positive=True, max_value=10)
        )

    def image_query(self) -> ImageQuery:
        """
        Creates a fake `ImageQuery` instance.

        Returns:
            The `ImageQuery` that it created.

        """
        # Create the fake range values.
        min_session_num = self.random_int()
        max_session_num = self.random_int(min=min_session_num)

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
            session_numbers=ImageQuery.Range(
                min_value=min_session_num, max_value=max_session_num
            ),
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
