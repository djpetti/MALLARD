"""
Contains custom `Faker` providers.
"""


import io
from typing import Any, Set

from faker import Faker
from faker.providers import BaseProvider
from PIL import Image

from mallard.routers.images.models import CreateResponse, QueryResponse


class ImageProvider(BaseProvider):
    """
    Faker provider for faking data used by the image endpoints.
    """

    def __init__(self, *args: Any, **kwargs: Any):
        super().__init__(*args, **kwargs)

        self.__faker = Faker()

    def create_response(self) -> CreateResponse:
        """
        Returns:
            The fake `CreateResponse` object that it created.

        """
        return CreateResponse(image_id=self.__faker.uuid4())

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
        image_ids = [self.__faker.uuid4() for _ in range(num_results)]

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
