"""
Contains custom `Faker` providers.
"""


import io
import unittest.mock as mock
from datetime import datetime
from typing import Any, Dict, Optional, Set

from exifread.classes import IfdTag
from exifread.utils import Ratio
from faker import Faker
from faker.providers import BaseProvider
from PIL import Image

from ....backends.objects.models import ObjectRef
from ..image_metadata import ExifReader
from ..models import CreateResponse, QueryResponse


class ImageProvider(BaseProvider):
    """
    Faker provider for faking data used by the image endpoints.
    """

    def __init__(self, *args: Any, **kwargs: Any):
        super().__init__(*args, **kwargs)

        self.__faker = Faker()

    def object_ref(self) -> ObjectRef:
        """
        Creates a reference to a fake object.

        Returns:
            The reference that it created.

        """
        return ObjectRef(
            bucket=self.__faker.pystr(), name=self.__faker.pystr()
        )

    def create_response(self) -> CreateResponse:
        """
        Returns:
            The fake `CreateResponse` object that it created.

        """
        return CreateResponse(image_id=self.object_ref())

    def query_response(
        self, min_num_results: int = 0, max_num_results: int = 50
    ) -> QueryResponse:
        """
        Args:
            min_num_results: The minimum number of image results to return
                in the response.
            max_num_results: The maximum number of image results to return
                in the response.

        Returns:
            The fake `QueryResponse` object that it created.

        """
        # Create some fake image IDs.
        num_results = self.random_int(min=min_num_results, max=max_num_results)
        image_ids = [self.object_ref() for _ in range(num_results)]

        return QueryResponse(
            image_ids=image_ids,
            page_num=self.random_int(),
            is_last_page=self.__faker.pybool(),
        )

    def image(
        self, formats: Set[str] = frozenset({"jpeg", "png"})
    ) -> io.BytesIO:
        """
        Creates a fake compressed image.

        Args:
            formats: The possible file formats to use.

        Returns:
            The compressed image, as a byte stream.

        """
        # Generate a random image.
        image_bytes = self.__faker.binary(100 * 100 * 3)
        image = Image.frombytes("RGB", size=(100, 100), data=image_bytes)

        # Compress it.
        compressed = io.BytesIO()
        image_format = self.random_element(formats)
        image.save(compressed, format=image_format)
        compressed.seek(0)
        return compressed


class ExifProvider(BaseProvider):
    """
    A provider for fake EXIF data.
    """

    def __init__(self, *args: Any, **kwargs: Any):
        super().__init__(*args, **kwargs)

        self.__faker = Faker()

    def image_make(self) -> IfdTag:
        """
        Creates a fake `Image Make` tag.

        Returns:
            The mocked tag that it created.

        """
        make = self.__faker.text(max_nb_chars=20)

        return mock.create_autospec(IfdTag, instance=True, values=make)

    def image_model(self) -> IfdTag:
        """
        Creates a fake `ImageModel` tag.

        Returns:
            The mocked tag that it created.

        """
        # This is the same as image_make for now.
        return self.image_make()

    def image_date_time(self, date_time: Optional[datetime] = None) -> IfdTag:
        """
        Creates a fake `Image DateTime` tag.

        Args:
            date_time: Optionally specify a particular date and time to use
                for the tag. Otherwise, will create a random one.

        Returns:
            The mocked tag that it created.

        """
        if date_time is None:
            date_time = self.__faker.date_time()
        # Format it the same way as EXIF.
        date_str = date_time.strftime("%Y:%m:%d %H:%M:%S")

        return mock.create_autospec(IfdTag, instance=True, values=date_str)

    def gps_latitude_ref(self) -> IfdTag:
        """
        Creates a fake `GPS GPSLatitudeRef` tag.

        Returns:
            The mocked tag that it created.

        """
        reference = self.random_element(("E", "W"))

        return mock.create_autospec(IfdTag, instance=True, values=reference)

    def gps_longitude_ref(self) -> IfdTag:
        """
        Creates a fake `GPS GPSLongitudeRef` tag.

        Returns:
            The mocked tag that it created.

        """
        reference = self.random_element(("N", "S"))

        return mock.create_autospec(IfdTag, instance=True, values=reference)

    def __gps_coordinate(self, *, max_degree: int) -> IfdTag:
        """
        Creates an EXIF tag for a fake GPS coordinate.

        Args:
            max_degree: The maximum value to use for the coordinate degree.

        Returns:
            The mocked tag that it created.

        """
        # Create the coordinate value in DMS.
        degrees = self.random_int(min=0, max=max_degree)
        minutes = self.random_int(min=0, max=59)
        seconds = self.__faker.pydecimal(min_value=0, max_value=3600)

        # Convert them all to ratios.
        degrees = Ratio(degrees, 1)
        minutes = Ratio(minutes, 1)
        seconds = Ratio(*seconds.as_integer_ratio())

        return mock.create_autospec(
            IfdTag, instance=True, values=[degrees, minutes, seconds]
        )

    def gps_latitude(self) -> IfdTag:
        """
        Creates a fake `GPS GPSLatitude` tag.

        Returns:
            The mocked tag that it created.

        """
        return self.__gps_coordinate(max_degree=89)

    def gps_longitude(self) -> IfdTag:
        """
        Creates a fake `GPS GPSLongitude` tag.

        Returns:
            The mocked tag that it created.

        """
        return self.__gps_coordinate(max_degree=179)

    def exif_tags(self) -> Dict[str, IfdTag]:
        """
        Creates a fake set of EXIF tags.

        Returns:
            Dictionary mapping tag names to tags.

        """
        tags = ExifReader.ExifTag
        return {
            tags.IMAGE_DATE_TIME.value: self.image_date_time(),
            tags.IMAGE_MAKE.value: self.image_make(),
            tags.IMAGE_MODEL.value: self.image_model(),
            tags.GPS_LATITUDE.value: self.gps_latitude(),
            tags.GPS_LONGITUDE.value: self.gps_longitude(),
            tags.GPS_LATITUDE_REF.value: self.gps_latitude_ref(),
            tags.GPS_LONGITUDE_REF.value: self.gps_longitude_ref(),
        }
