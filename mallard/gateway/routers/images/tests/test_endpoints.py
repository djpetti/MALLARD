"""
Unit tests for the `endpoints` module.
"""


import unittest.mock as mock
from concurrent.futures import ThreadPoolExecutor
from datetime import timezone
from typing import Type

import pytest
from faker import Faker
from fastapi import HTTPException, UploadFile
from pydantic.dataclasses import dataclass
from pytest_mock import MockFixture

from mallard.gateway.artifact_metadata import MissingLengthError
from mallard.gateway.backends.metadata import MetadataOperationError
from mallard.gateway.backends.metadata.schemas import UavImageMetadata
from mallard.gateway.backends.objects import ObjectOperationError
from mallard.gateway.backends.objects.models import ObjectRef
from mallard.gateway.routers.conftest import ConfigForTests
from mallard.gateway.routers.images import InvalidImageError, endpoints
from mallard.type_helpers import ArbitraryTypesConfig


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
    assert got_image_id.name.endswith(
        create_uav_params.mock_uuid.return_value.hex
    )

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
async def test_delete_images(config: ConfigForTests, faker: Faker) -> None:
    """
    Tests that the `delete_images` endpoint works.

    Args:
        config: The configuration to use for testing.
        faker: The fixture to use for generating fake data.

    """
    # Arrange.
    # Generate fake objects.
    num_to_delete = faker.random_int(min=1, max=10)
    object_refs = [faker.object_ref() for _ in range(num_to_delete)]

    # Act.
    await endpoints.delete_images(
        images=object_refs,
        object_store=config.mock_object_store,
        metadata_store=config.mock_metadata_store,
    )

    # Assert.
    # It should have deleted the corresponding items in both databases.
    assert (
        config.mock_object_store.delete_object.call_count == num_to_delete * 2
    )
    assert config.mock_metadata_store.delete.call_count == num_to_delete
    for object_ref in object_refs:
        config.mock_object_store.delete_object.assert_any_call(object_ref)
        config.mock_object_store.delete_object.assert_any_call(
            ObjectRef(
                bucket=object_ref.bucket, name=f"{object_ref.name}.thumbnail"
            )
        )
        config.mock_metadata_store.delete.assert_any_call(object_ref)


@pytest.mark.asyncio
async def test_delete_images_nonexistent(
    config: ConfigForTests, faker: Faker
) -> None:
    """
    Tests that the `delete_images` endpoint handles the case where an image
    doesn't exist in the first place.

    Args:
        config: The configuration to use for testing.
        faker: The fixture to use for generating fake data.

    """
    # Arrange.
    # Generate fake objects to try deleting.
    num_successful = faker.random_int(max=10)
    num_failed = faker.random_int(min=1, max=10)
    successful_objects = [faker.object_ref() for _ in range(num_successful)]
    failed_objects = [faker.object_ref() for _ in range(num_failed)]

    # Make it look like at least one image was not found.
    return_values = [mock.DEFAULT for _ in range(num_successful)] + [
        KeyError for _ in range(num_failed)
    ]
    config.mock_object_store.delete_object.side_effect = return_values
    config.mock_metadata_store.delete.side_effect = return_values

    # Act and assert.
    with pytest.raises(HTTPException) as error:
        await endpoints.delete_images(
            images=successful_objects + failed_objects,
            object_store=config.mock_object_store,
            metadata_store=config.mock_metadata_store,
        )

        # It should have specified the failed objects in the error message.
        error_message = str(error.value)
        for object_ref in failed_objects:
            assert object_ref.bucket in error_message
            assert object_ref.name in error_message


@pytest.mark.asyncio
async def test_delete_images_other_error(config: ConfigForTests, faker: Faker):
    """
    Tests that the `delete_images` endpoint handles the case where some
    unexpected error occurs.

    Args:
        config: The configuration to use for testing.
        faker: The fixture to use for generating fake data.

    """
    # Arrange.
    object_id = faker.object_ref()
    config.mock_object_store.delete_object.side_effect = ValueError

    # Act and assert.
    with pytest.raises(ExceptionGroup) as errors:
        await endpoints.delete_images(
            images=[object_id],
            object_store=config.mock_object_store,
            metadata_store=config.mock_metadata_store,
        )
        assert errors.value.subgroup(KeyError) is not None

    config.mock_object_store.delete_object.assert_called()


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
        image_stream, media_type=mock.ANY, headers=mock.ANY
    )

    # Check the headers.
    _, response_kwargs = config.mock_streaming_response_class.call_args
    headers = response_kwargs["headers"]
    # assert headers["Content-Length"] == str(metadata.size)
    assert "attachment" in headers["Content-Disposition"]
    assert metadata.name in headers["Content-Disposition"]

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
@pytest.mark.parametrize(
    "num_images", [8, 1, 0], ids=["multiple", "single", "none"]
)
async def test_find_image_metadata(
    config: ConfigForTests, faker: Faker, num_images: int
) -> None:
    """
    Tests that `find_image_metadata` works.

    Args:
        config: The configuration to use for testing.
        faker: The fixture to use for generating fake data.
        num_images: The number of images to use for testing.

    """
    # Arrange.
    # Generate fake bucket and image names.
    object_refs = [faker.object_ref() for _ in range(num_images)]

    # Make it look like it get valid metadata from the database.
    config.mock_metadata_store.get.return_value = faker.image_metadata()

    # Act.
    response = (
        await endpoints.find_image_metadata(
            images=object_refs,
            metadata_store=config.mock_metadata_store,
        )
    ).metadata

    # Assert.
    # It should have gotten the metadata.
    assert config.mock_metadata_store.get.call_count == num_images
    for object_id in object_refs:
        config.mock_metadata_store.get.assert_any_call(object_id)
    assert (
        response == [config.mock_metadata_store.get.return_value] * num_images
    )


@pytest.mark.asyncio
async def test_find_image_metadata_nonexistent(
    config: ConfigForTests, faker: Faker
) -> None:
    """
    Tests that the `find_image_metadata` endpoint handles it correctly when
    the specified image does not exist.

    Args:
        config: The configuration to use for testing.
        faker: The fixture to use for generating fake data.

    """
    # Arrange.
    # Generate fake bucket and image names.
    existing_object_id = faker.object_ref()
    missing_object_id = faker.object_ref()
    object_refs = [existing_object_id, missing_object_id]

    # Make it look like one of the images doesn't exist.
    config.mock_metadata_store.get.side_effect = [mock.DEFAULT, KeyError]

    # Act and assert.
    with pytest.raises(HTTPException) as exc_info:
        await endpoints.find_image_metadata(
            images=object_refs,
            metadata_store=config.mock_metadata_store,
        )

        # This should be a 404 error.
        assert exc_info.value.status_code == 404
        # It should have a message that indicates which image was not found.
        assert missing_object_id.bucket in exc_info.value.detail
        assert missing_object_id.name in exc_info.value.detail


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

    metadata = faker.image_metadata()

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
