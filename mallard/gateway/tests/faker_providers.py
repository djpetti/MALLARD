"""
Contains custom `Faker` providers.
"""

import unittest.mock as mock
from tempfile import SpooledTemporaryFile
from typing import Any, Dict, Optional

from faker import Faker
from faker.providers import BaseProvider
from fastapi import UploadFile
from fief_client import FiefAccessTokenInfo, FiefACR


class FastApiProvider(BaseProvider):
    """
    Faker provider for faking `FastAPI` data types.
    """

    def __init__(self, *args: Any, **kwargs: Any):
        super().__init__(*args, **kwargs)

        self.__faker = Faker()

    def upload_file(
        self,
        category: Optional[str] = None,
        contents: Optional[bytes] = None,
        headers: Optional[Dict[str, str]] = None,
    ) -> UploadFile:
        """
        Creates a fake `UploadFile` object.

        Args:
            category: The category for the fake file. See the `Faker`
                documentation for valid values.
            contents: Specific file contents to simulate.
            headers: HTTP headers to use for the file. If not specified,
                it will default to adding a content-length header.

        Returns:
            The mock `UploadFile` that it created.

        """
        if contents is None:
            contents = self.__faker.binary(length=64)

        file_name = self.__faker.file_name(category=category)
        mime_type = self.__faker.mime_type(category=category)

        upload_file = mock.create_autospec(
            UploadFile,
            instance=True,
            filename=file_name,
            content_type=mime_type,
        )

        # Mock the underlying file handle.
        underlying_file = SpooledTemporaryFile()
        underlying_file.write(contents)
        underlying_file.seek(0)
        upload_file.file = underlying_file

        # Make it look like the file contains some data.
        upload_file.read.side_effect = underlying_file.read
        upload_file.seek.side_effect = underlying_file.seek

        # Make it look like the file has headers.
        if headers is None:
            # Add a valid content-length by default.
            headers = {"content-length": len(contents)}
        upload_file.headers = headers.copy()

        return upload_file


class FiefProvider(BaseProvider):
    """
    A provider for Fief datatypes.
    """

    def __init__(self, *args: Any, **kwargs: Any):
        super().__init__(*args, **kwargs)
        self.__faker = Faker()

    def fief_access_token_info(self) -> FiefAccessTokenInfo:
        """
        Returns:
            The fake `FiefAccessTokenInfo` object that it created.

        """
        return FiefAccessTokenInfo(
            id=self.__faker.uuid4(),
            scope=[self.__faker.word()],
            acr=FiefACR.LEVEL_ONE,
            permissions=self.random_elements(
                ["read", "create", "update", "delete"]
            ),
            access_token=self.__faker.pystr(),
        )
