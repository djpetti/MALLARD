"""
Testing configuration file.
"""


import pytest
from faker import Faker

from .backends.metadata.tests.faker_providers import MetadataProvider
from .backends.objects.tests.faker_providers import S3Provider
from .routers.images.tests.faker_providers import ExifProvider, ImageProvider
from .routers.videos.tests.faker_providers import VideoProvider
from .tests.faker_providers import FastApiProvider


@pytest.fixture(autouse=True)
def set_faker_seed() -> None:
    """
    Sets a seed for the `Faker` that will be used for all tests.

    **Note:** This is deliberately function-scoped because I don't like the
    idea of my test results changing depending on what order they run in.
    Therefore, we explicitly set the same seed for every test.

    """
    Faker.seed(1337)


@pytest.fixture(autouse=True)
def add_custom_faker_providers(faker: Faker) -> None:
    """
    Adds our custom providers to every `Faker` instance so that we don't have to
    do it manually.

    Args:
        faker: The fixture to use for creating fake data.

    """
    faker.add_provider(ImageProvider)
    faker.add_provider(ExifProvider)
    faker.add_provider(FastApiProvider)
    faker.add_provider(MetadataProvider)
    faker.add_provider(S3Provider)
    faker.add_provider(VideoProvider)
