"""
Contains custom `Faker` providers.
"""


import unittest.mock as mock
from tempfile import SpooledTemporaryFile
from typing import Any, Optional

from faker import Faker
from faker.providers import BaseProvider
from fastapi import UploadFile


class FastApiProvider(BaseProvider):
    """
    Faker provider for faking `FastAPI` data types.
    """

    def __init__(self, *args: Any, **kwargs: Any):
        super().__init__(*args, **kwargs)

        self.__faker = Faker()

    def upload_file(
        self, category: Optional[str] = None, contents: Optional[bytes] = None
    ) -> UploadFile:
        """
        Creates a fake `UploadFile` object.

        Args:
            category: The category for the fake file. See the `Faker`
                documentation for valid values.
            contents: Specific file contents to simulate.

        Returns:
            The mock `UploadFile` that it created.

        """
        if contents is None:
            contents = self.__faker.binary(length=64)

        file_name = self.__faker.file_name(category=category)

        upload_file = mock.create_autospec(
            UploadFile, instance=True, filename=file_name
        )

        # Make it look like the file contains some data.
        upload_file.read.side_effect = (contents, b"")

        # Mock the underlying file handle.
        mock_file = mock.create_autospec(SpooledTemporaryFile, instance=True)
        mock_file.read.side_effect = (contents, b"")
        upload_file.file = mock_file

        return upload_file
