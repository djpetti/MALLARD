"""
Contains custom `Faker` providers.
"""


from typing import Any

from botocore.exceptions import ClientError
from faker import Faker
from faker.providers import BaseProvider


class S3Provider(BaseProvider):
    """
    Faker provider for faking data used by S3 object stores.
    """

    def __init__(self, *args: Any, **kwargs: Any):
        super().__init__(*args, **kwargs)

        self.__faker = Faker()

    def client_error(self, error_code: str) -> ClientError:
        """
        Creates a fake `ClientError` with the specified code.

        Args:
            error_code: The error code.

        Returns:
            The fake error it created.

        """
        # Create a fake error message.
        error_message = self.__faker.sentence()
        op_name = self.__faker.word()
        response = dict(Error=dict(Code=error_code, Message=error_message))

        return ClientError(response, op_name)
