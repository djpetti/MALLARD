"""
Unit tests for the `endpoints` class.
"""


import unittest.mock as mock
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta, timezone
from typing import AsyncIterable, Type

import pytest
from faker import Faker
from fastapi import HTTPException, UploadFile
from pydantic.dataclasses import dataclass
from pytest_mock import MockFixture

from mallard.gateway.backends.metadata import (
    ImageMetadataStore,
    MetadataOperationError,
)
from mallard.gateway.backends.metadata.schemas import (
    ImageQuery,
    UavImageMetadata,
)
from mallard.gateway.backends.objects import ObjectOperationError, ObjectStore
from mallard.gateway.backends.objects.models import ObjectRef
from mallard.gateway.routers.images import (
    InvalidImageError,
    MissingLengthError,
    endpoints,
)
from mallard.type_helpers import ArbitraryTypesConfig


@dataclass(frozen=True, config=ArbitraryTypesConfig)
class ConfigForTests:
    """
    Encapsulates standard configuration for most tests.

    Attributes:
        mock_object_store: The mocked `ObjectStore` instance.
        mock_metadata_store: The mocked `ImageMetadataStore` instance.
        mock_streaming_response_class: The mocked `StreamingResponse` class.
    """

    mock_object_store: ObjectStore
    mock_metadata_store: ImageMetadataStore
    mock_streaming_response_class: mock.Mock


@dataclass(frozen=True, config=ArbitraryTypesConfig)
class CreateUavParams:
    """
    Encapsulates common parameters for testing the `create_uav_images` endpoint.

    Attributes:
        mock_file: The mocked `UploadFile` to use.
        mock_metadata: The mocked `UavImageMetadata` structure.
        mock_uuid: The mocked `uuid.uuid4` function.
        bucket_id: The ID of the bucket to use for testing.

    """

    mock_file: UploadFile
    mock_metadata: UavImageMetadata
    mock_uuid: mock.Mock
    bucket_id: str


@pytest.fixture
def config(mocker: MockFixture) -> ConfigForTests:
    """
    Generates standard configuration for most tests.

    Args:
        mocker: The fixture to use for mocking.

    Returns:
        The configuration that it generated.

    """
    mock_object_store = mocker.create_autospec(ObjectStore, instance=True)
    mock_metadata_store = mocker.create_autospec(
        ImageMetadataStore, instance=True
    )

    mock_streaming_response_class = mocker.patch(
        endpoints.__name__ + ".StreamingResponse"
    )

    return ConfigForTests(
        mock_object_store=mock_object_store,
        mock_metadata_store=mock_metadata_store,
        mock_streaming_response_class=mock_streaming_response_class,
    )


@pytest.fixture
def create_uav_params(
    config: ConfigForTests, faker: Faker, mocker: MockFixture
) -> CreateUavParams:
    """
    Generates common parameters for testing the `create_uav_image` endpoint.

    Args:
        config: The configuration to use for testing.
        faker: The fixture to use for generating fake data.
        mocker: The fixture to use for mocking.

    Returns:
        The parameters that it created.

    """
    # Create a fake file to upload.
    mock_file = faker.upload_file()
    # Create fake metadata.
    mock_metadata = mocker.create_autospec(UavImageMetadata, instance=True)

    # Make the UUID deterministic.
    mock_uuid = mocker.patch("uuid.uuid4")
    mock_uuid.return_value.hex = faker.uuid4()

    # Create a fake bucket.
    bucket = faker.pystr()

    return CreateUavParams(
        mock_file=mock_file,
        mock_metadata=mock_metadata,
        mock_uuid=mock_uuid,
        bucket_id=bucket,
    )


@pytest.mark.asyncio
async def test_create_uav_image(
    config: ConfigForTests,
    create_uav_params: CreateUavParams,
    mocker: MockFixture,
) -> None:
    """
    Tests that `create_uav_image` works.

    Args:
        config: The configuration to use for testing.
        create_uav_params: Common parameters for testing this endpoint.
        mocker: The fixture to use for mocking.

    """
    # Arrange.
    # Mock out the PIL Image class.
    mock_image_class = mocker.patch(endpoints.__name__ + ".Image")

    # Turn the process pool into a thread pool to make testing easier.
    mock_get_process_pool = mocker.patch(
        endpoints.__name__ + ".get_process_pool"
    )
    mock_get_process_pool.side_effect = ThreadPoolExecutor

    # Act.
    response = await endpoints.create_uav_image(
        metadata=create_uav_params.mock_metadata,
        image_data=create_uav_params.mock_file,
        object_store=config.mock_object_store,
        metadata_store=config.mock_metadata_store,
        bucket=create_uav_params.bucket_id,
    )

    # Assert.
    # It should have named the object correctly.
    got_image_id = response.image_id
    assert got_image_id.bucket == create_uav_params.bucket_id
    assert got_image_id.name == create_uav_params.mock_uuid.return_value.hex

    # It should have updated the databases.
    assert config.mock_object_store.create_object.call_count == 2
    config.mock_object_store.create_object.assert_any_call(
        got_image_id, data=create_uav_params.mock_file
    )
    config.mock_metadata_store.add.assert_called_once_with(
        object_id=got_image_id, metadata=create_uav_params.mock_metadata
    )

    # It should have created the thumbnail.
    create_uav_params.mock_file.read.assert_called_once_with()
    mock_image_class.open.assert_called_once()
    mock_image = mock_image_class.open.return_value
    mock_image.thumbnail.assert_called_once()

    mock_image.convert.assert_called_once_with("RGB")
    mock_image = mock_image.convert.return_value

    mock_image.save.assert_called_once_with(mock.ANY, format="jpeg")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "exception",
    (ObjectOperationError, MetadataOperationError),
    ids=("object_failure", "metadata_failure"),
)
async def test_create_uav_image_write_failure(
    config: ConfigForTests,
    create_uav_params: CreateUavParams,
    exception: Type[Exception],
) -> None:
    """
    Tests that `create_uav_image` handles it when a database write fails.

    Args:
        config: The configuration to use for testing.
        create_uav_params: Common parameters for testing this endpoint.
        exception: The specific failure mode to test.

    """
    # Arrange.
    # Make it look like the operations failed.
    config.mock_object_store.create_object.side_effect = exception
    config.mock_metadata_store.add.side_effect = exception

    # Act and assert.
    with pytest.raises(exception):
        await endpoints.create_uav_image(
            metadata=create_uav_params.mock_metadata,
            image_data=create_uav_params.mock_file,
            object_store=config.mock_object_store,
            metadata_store=config.mock_metadata_store,
            bucket=create_uav_params.bucket_id,
        )

    # Assert
    # It should have deleted whichever one didn't fail.
    if exception is ObjectOperationError:
        config.mock_metadata_store.delete.assert_called_once()
    else:
        # It should have deleted both the object and its thumbnail.
        assert config.mock_object_store.delete_object.call_count == 2


@pytest.mark.asyncio
async def test_delete_image(config: ConfigForTests, faker: Faker) -> None:
    """
    Tests that the `delete_image` endpoint works.

    Args:
        config: The configuration to use for testing.
        faker: The fixture to use for generating fake data.

    """
    # Arrange.
    # Generate fake bucket and image names.
    bucket = faker.pystr()
    image_name = faker.pystr()

    # Act.
    await endpoints.delete_images(
        bucket=bucket,
        name=image_name,
        object_store=config.mock_object_store,
        metadata_store=config.mock_metadata_store,
    )

    # Assert.
    # It should have deleted the corresponding items in both databases.
    object_id = ObjectRef(bucket=bucket, name=image_name)
    config.mock_object_store.delete_object.assert_called_once_with(object_id)
    config.mock_metadata_store.delete.assert_called_once_with(object_id)


@pytest.mark.asyncio
async def test_delete_image_nonexistent(
    config: ConfigForTests, faker: Faker
) -> None:
    """
    Tests that the `delete_image` endpoint handles the case where the image
    doesn't exist in the first place.

    Args:
        config: The configuration to use for testing.
        faker: The fixture to use for generating fake data.

    """
    # Arrange.
    # Generate fake bucket and image names.
    bucket = faker.pystr()
    image_name = faker.pystr()

    # Make it look like the image was not found.
    config.mock_object_store.delete_object.side_effect = KeyError
    config.mock_metadata_store.delete.side_effect = KeyError

    # Act and assert.
    with pytest.raises(HTTPException):
        await endpoints.delete_images(
            bucket=bucket,
            name=image_name,
            object_store=config.mock_object_store,
            metadata_store=config.mock_metadata_store,
        )


@pytest.mark.asyncio
async def test_get_image(config: ConfigForTests, faker: Faker) -> None:
    """
    Tests that the `get_image` endpoint works.

    Args:
        config: The configuration to use for testing.
        faker: The fixture to use for generating fake data.

    """
    # Arrange.
    # Make it look like we have a valid image format.
    metadata = faker.image_metadata()
    config.mock_metadata_store.get.return_value = metadata

    # Generate fake bucket and image names.
    bucket = faker.pystr()
    image_name = faker.pystr()

    # Act.
    response = await endpoints.get_image(
        bucket=bucket,
        name=image_name,
        object_store=config.mock_object_store,
        metadata_store=config.mock_metadata_store,
    )

    # Assert.
    # It should have gotten the image.
    object_id = ObjectRef(bucket=bucket, name=image_name)
    config.mock_object_store.get_object.assert_called_once_with(object_id)
    image_stream = config.mock_object_store.get_object.return_value

    # It should have used a StreamingResponse object.
    config.mock_streaming_response_class.assert_called_once_with(
        image_stream, media_type=mock.ANY
    )
    assert response == config.mock_streaming_response_class.return_value


@pytest.mark.asyncio
async def test_get_image_nonexistent(
    config: ConfigForTests, faker: Faker
) -> None:
    """
    Tests that the `get_image` endpoint handles the case where the image does
    not exist.

    Args:
        config: The configuration to use for testing.
        faker: The fixture to use for generating fake data.

    """
    # Arrange.
    # Generate fake bucket and image names.
    bucket = faker.pystr()
    image_name = faker.pystr()

    # Make it look like the image doesn't exist.
    config.mock_object_store.get_object.side_effect = KeyError

    # Act and assert.
    with pytest.raises(HTTPException):
        await endpoints.get_image(
            bucket=bucket,
            name=image_name,
            object_store=config.mock_object_store,
            metadata_store=config.mock_metadata_store,
        )


@pytest.mark.asyncio
async def test_get_thumbnail(config: ConfigForTests, faker: Faker) -> None:
    """
    Tests that the `get_thumbnail` endpoint works.

    Args:
        config: The configuration to use for testing.
        faker: The fixture to use for generating fake data.

    """
    # Arrange.
    # Generate fake bucket and image names.
    bucket = faker.pystr()
    image_name = faker.pystr()

    # Act.
    response = await endpoints.get_thumbnail(
        bucket=bucket,
        name=image_name,
        object_store=config.mock_object_store,
    )

    # Assert.
    # It should have gotten the thumbnail.
    config.mock_object_store.get_object.assert_called_once()
    args, _ = config.mock_object_store.get_object.call_args
    thumbnail_id = args[0]
    assert thumbnail_id.bucket == bucket
    # The name for this object should be distinct from that of the raw image.
    assert thumbnail_id.name != image_name
    image_stream = config.mock_object_store.get_object.return_value

    # It should have used a StreamingResponse object.
    config.mock_streaming_response_class.assert_called_once_with(
        image_stream, media_type="image/jpeg"
    )
    assert response == config.mock_streaming_response_class.return_value


@pytest.mark.asyncio
async def test_get_thumbnail_nonexistent(
    config: ConfigForTests, faker: Faker
) -> None:
    """
    Tests that the `get_thumbnail` endpoint handles the case where the image
    does not exist.

    Args:
        config: The configuration to use for testing.
        faker: The fixture to use for generating fake data.

    """
    # Arrange.
    # Generate fake bucket and image names.
    bucket = faker.pystr()
    image_name = faker.pystr()

    # Make it look like the image doesn't exist.
    config.mock_object_store.get_object.side_effect = KeyError

    # Act and assert.
    with pytest.raises(HTTPException):
        await endpoints.get_thumbnail(
            bucket=bucket,
            name=image_name,
            object_store=config.mock_object_store,
        )


@pytest.mark.asyncio
async def test_get_image_metadata(
    config: ConfigForTests, faker: Faker
) -> None:
    """
    Tests that `get_image_metadata` works.

    Args:
        config: The configuration to use for testing.
        faker: The fixture to use for generating fake data.

    """
    # Arrange.
    # Generate fake bucket and image names.
    bucket = faker.pystr()
    image_name = faker.pystr()

    # Act.
    response = await endpoints.get_image_metadata(
        bucket=bucket,
        name=image_name,
        metadata_store=config.mock_metadata_store,
    )

    # Assert.
    # It should have gotten the metadata.
    object_id = ObjectRef(bucket=bucket, name=image_name)
    config.mock_metadata_store.get.assert_called_once_with(object_id)
    assert response == config.mock_metadata_store.get.return_value


@pytest.mark.asyncio
async def test_get_image_metadata_nonexistent(
    config: ConfigForTests, faker: Faker
) -> None:
    """
    Tests that the `get_image_metadata` endpoint handles it correctly when
    the specified image does not exist.

    Args:
        config: The configuration to use for testing.
        faker: The fixture to use for generating fake data.

    """
    # Arrange.
    # Generate fake bucket and image names.
    bucket = faker.pystr()
    image_name = faker.pystr()

    # Make it look like the image doesn't exist.
    config.mock_metadata_store.get.side_effect = KeyError

    # Act and assert.
    with pytest.raises(HTTPException):
        await endpoints.get_image_metadata(
            bucket=bucket,
            name=image_name,
            metadata_store=config.mock_metadata_store,
        )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "increment_sequence", [False, True], ids=("no_increment", "increment")
)
async def test_batch_update_metadata(
    config: ConfigForTests, faker: Faker, increment_sequence: bool
) -> None:
    """
    Tests that `batch_update_metadata` works.

    Args:
        config: The configuration to use for testing.
        faker: The fixture to use for generating fake data.
        increment_sequence: Whether to test with auto-incrementing sequence
            numbers.

    """
    # Arrange.
    # Generate some fake objects.
    object_ids = []
    for _ in range(faker.random_int(max=20)):
        object_ids.append(faker.object_ref())

    metadata = faker.uav_image_metadata()

    # Act.
    await endpoints.batch_update_metadata(
        metadata=metadata,
        images=object_ids,
        increment_sequence=increment_sequence,
        metadata_store=config.mock_metadata_store,
    )

    # Assert.
    # For the case where we are incrementing, the metadata will be different.
    if increment_sequence:
        expected_metadata = [
            metadata.copy(update=dict(sequence_number=i))
            for i in range(
                metadata.sequence_number,
                metadata.sequence_number + len(object_ids),
            )
        ]
    else:
        expected_metadata = [metadata] * len(object_ids)

    # It should have updated all of the metadata.
    config.mock_metadata_store.update.assert_has_calls(
        [
            mock.call(object_id=o, metadata=m)
            for o, m in zip(object_ids, expected_metadata)
        ]
    )


@pytest.mark.asyncio
async def test_infer_metadata(create_uav_params: CreateUavParams) -> None:
    """
    Tests that `infer_metadata` works.

    Args:
        create_uav_params: Common parameters for testing image creation.

    """
    # Act.
    got_metadata = await endpoints.infer_image_metadata(
        create_uav_params.mock_metadata
    )

    # Assert.
    # Without dependencies, this should just function as a pass-through.
    assert got_metadata == create_uav_params.mock_metadata


@pytest.mark.asyncio
@pytest.mark.parametrize(
    (
        "results_per_page",
        "page_num",
        "total_results",
        "is_last",
        "multiple_queries",
    ),
    (
        (10, 1, 5, True, False),
        (20, 2, 40, False, False),
        (20, 3, 40, True, False),
        (5, 2, 16, False, False),
        (10, 5, 5, True, False),
        (10, 1, 5, True, True),
    ),
    ids=(
        "fits_on_one_page",
        "exact_page_division",
        "empty_last_page",
        "truncated_results",
        "out_of_bounds",
        "multiple_queries",
    ),
)
async def test_query_images(
    config: ConfigForTests,
    faker: Faker,
    mocker: MockFixture,
    results_per_page: int,
    page_num: int,
    total_results: int,
    is_last: bool,
    multiple_queries: bool,
) -> None:
    """
    Tests that the `query_image` endpoint works.

    Args:
        config: The configuration to use for testing.
        faker: The fixture to use for generating fake data.
        mocker: The fixture to use for mocking.
        results_per_page: Max number of query results per page.
        page_num: Page number to retrieve.
        total_results: Total number of results that will be produced.
        is_last: True if we expect it to report that this is the last page.
        multiple_queries: Whether to simulate running more than one query at
            once.

    """
    # Arrange.
    # Generate a fake query.
    mock_queries = [mocker.create_autospec(ImageQuery, instance=True)]
    if multiple_queries:
        mock_queries.append(mocker.create_autospec(ImageQuery, instance=True))

    # Fake the query results.
    async def query_results() -> AsyncIterable:
        # Simulate the query skipping the first N results.
        num_results = total_results - (page_num - 1) * results_per_page
        # Simulate the query limiting to the page size.
        num_results = min(num_results, results_per_page)
        for _ in range(num_results):
            yield faker.object_ref()

    config.mock_metadata_store.query.return_value = query_results()

    # Act.
    response = await endpoints.query_images(
        queries=mock_queries,
        orderings=[],
        results_per_page=results_per_page,
        page_num=page_num,
        metadata_store=config.mock_metadata_store,
    )

    # Assert.
    # It should have queried the backend.
    config.mock_metadata_store.query.assert_called_once_with(
        mock_queries,
        skip_first=(page_num - 1) * results_per_page,
        max_num_results=results_per_page,
        orderings=[],
    )

    # It should have gotten the number of images that it asked for.
    assert len(response.image_ids) <= results_per_page
    assert response.page_num == page_num
    assert response.is_last_page == is_last


@pytest.mark.asyncio
@pytest.mark.parametrize("exists", (True, False), ids=("existing", "new"))
async def test_use_bucket(
    config: ConfigForTests, mocker: MockFixture, faker: Faker, exists: bool
) -> None:
    """
    Tests that the `use_bucket` dependency function works.

    Args:
        config: The configuration to use for testing.
        mocker: The fixture to use for mocking.
        faker: The fixture to use for generating fake data.
        exists: Whether we want to simulate the bucket already existing or not.

    """
    # Arrange.
    # Make it produce a consistent date.
    mock_date_class = mocker.patch(endpoints.__name__ + ".date")
    fake_date = faker.date()
    mock_date_class.today.return_value.isoformat.return_value = fake_date

    config.mock_object_store.bucket_exists.return_value = False
    if exists:
        # Make it look like the bucket already exists.
        config.mock_object_store.bucket_exists.return_value = True

    # Act.
    got_bucket = await endpoints.use_bucket(config.mock_object_store)

    # Assert.
    # It should have produced a good name.
    assert fake_date in got_bucket

    # It should have created the bucket only if necessary.
    config.mock_object_store.bucket_exists.assert_called_once_with(got_bucket)
    if not exists:
        config.mock_object_store.create_bucket.assert_called_once_with(
            got_bucket, exists_ok=True
        )
    else:
        config.mock_object_store.create_bucket.assert_not_called()


def test_user_timezone(faker: Faker) -> None:
    """
    Tests that the `user_timezone` dependency function works.

    Args:
        faker: The fixture to use for generating fake data.

    """
    # Arrange.
    offset = faker.random_int(min=-24, max=24)

    # Act.
    got_timezone = endpoints.user_timezone(offset)

    # Assert.
    assert got_timezone.utcoffset(None) == timedelta(hours=offset)


@pytest.mark.asyncio
async def test_filled_uav_metadata(mocker: MockFixture, faker: Faker) -> None:
    """
    Tests that the `filled_uav_metadata` dependency function works.

    Args:
        mocker: The fixture to use for mocking.
        faker: The fixture to use for generating fake data.

    """
    # Arrange.
    mock_metadata = mocker.create_autospec(UavImageMetadata, instance=True)
    mock_image_data = faker.upload_file()
    mock_timezone = mocker.create_autospec(timezone, instance=True)

    # Mock the underlying function that it calls.
    mock_fill_metadata = mocker.patch(endpoints.__name__ + ".fill_metadata")

    # Act.
    got_metadata = await endpoints.filled_uav_metadata(
        metadata=mock_metadata,
        image_data=mock_image_data,
        local_tz=mock_timezone,
    )

    # Assert.
    mock_fill_metadata.assert_called_once()
    assert got_metadata == mock_fill_metadata.return_value


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "error",
    [InvalidImageError, MissingLengthError],
    ids=["invalid_image", "missing_length"],
)
async def test_filled_uav_metadata_invalid(
    mocker: MockFixture, faker: Faker, error: type
) -> None:
    """
    Tests that `filled_uav_metadata` works when the image is invalid.

    Args:
        mocker: The fixture to use for mocking.
        faker: The fixture to use for generating fake data.
        error: The type of error we want to simulate.

    """
    # Arrange.
    mock_metadata = mocker.create_autospec(UavImageMetadata, instance=True)
    mock_image_data = faker.upload_file()
    mock_timezone = mocker.create_autospec(timezone, instance=True)

    # Mock the underlying function that it calls.
    mock_fill_metadata = mocker.patch(endpoints.__name__ + ".fill_metadata")
    mock_fill_metadata.side_effect = error

    # Act and assert.
    with pytest.raises(HTTPException):
        await endpoints.filled_uav_metadata(
            metadata=mock_metadata,
            image_data=mock_image_data,
            local_tz=mock_timezone,
        )
