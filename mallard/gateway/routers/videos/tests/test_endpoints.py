"""
Unit tests for the `endpoints` module.
"""

import unittest.mock as mock
from io import BytesIO
from typing import AsyncIterable, Awaitable, Callable, Type

import pytest
from faker import Faker
from fastapi import BackgroundTasks, HTTPException, UploadFile
from pydantic.dataclasses import dataclass
from pytest_mock import MockFixture
from starlette.responses import StreamingResponse

from mallard.gateway.artifact_metadata import MissingLengthError
from mallard.gateway.backends.metadata import MetadataOperationError
from mallard.gateway.backends.metadata.schemas import UavVideoMetadata
from mallard.gateway.backends.objects import (
    InvalidRangeError,
    ObjectOperationError,
    ObjectStore,
    ObjectStream,
)
from mallard.gateway.backends.objects.models import ObjectRef, derived_id
from mallard.gateway.routers.conftest import ConfigForTests
from mallard.gateway.routers.videos import InvalidVideoError, endpoints
from mallard.type_helpers import ArbitraryTypesConfig


@dataclass(frozen=True, config=ArbitraryTypesConfig)
class CreateUavParams:
    """
    Encapsulates common parameters for testing the `create_uav_video` endpoint.

    Attributes:
        mock_file: The mocked `UploadFile` to use.
        mock_metadata: The mocked `UavVideoMetadata` structure.
        mock_uuid: The mocked `uuid.uuid4` function.
        mock_background_tasks: The mocked `BackgroundTasks` object to use.
        bucket_id: The ID of the bucket to use for testing.

        mock_fill_metadata: The mocked `fill_metadata` function.

    """

    mock_file: UploadFile
    mock_metadata: UavVideoMetadata
    mock_uuid: mock.Mock
    mock_background_tasks: BackgroundTasks
    bucket_id: str

    mock_fill_metadata: mock.Mock


@dataclass(frozen=True, config=ArbitraryTypesConfig)
class MockedTranscoderClient:
    """
    Encapsulates mocked functions from the `transcoder_client` module.

    Attributes:
        mock_create_preview: The mocked `create_preview` function.
        mock_create_thumbnail: The mocked `create_thumbnail` function.
        mock_create_streamable: The mocked `create_streamable` function.

    """

    mock_create_preview: mock.Mock
    mock_create_thumbnail: mock.Mock
    mock_create_streamable: mock.Mock


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
    mock_metadata = mocker.create_autospec(UavVideoMetadata, instance=True)
    # Create a fake background tasks object.
    mock_background_tasks = mocker.create_autospec(
        BackgroundTasks, instance=True
    )

    # Make the UUID deterministic.
    mock_uuid = mocker.patch("uuid.uuid4")
    mock_uuid.return_value.hex = faker.uuid4()

    # Create a fake bucket.
    bucket = faker.pystr()

    mock_fill_metadata = mocker.patch(f"{endpoints.__name__}.fill_metadata")

    return CreateUavParams(
        mock_file=mock_file,
        mock_metadata=mock_metadata,
        mock_uuid=mock_uuid,
        mock_background_tasks=mock_background_tasks,
        bucket_id=bucket,
        mock_fill_metadata=mock_fill_metadata,
    )


@pytest.fixture
def mock_transcoder_client(mocker: MockFixture) -> MockedTranscoderClient:
    """
    Generates a mocked `transcoder_client` module.

    Args:
        mocker: The fixture to use for mocking.

    Returns:
        The mocked `transcoder_client` module.

    """
    return MockedTranscoderClient(
        mock_create_preview=mocker.patch(
            f"{endpoints.__name__}.create_preview"
        ),
        mock_create_thumbnail=mocker.patch(
            f"{endpoints.__name__}.create_thumbnail"
        ),
        mock_create_streamable=mocker.patch(
            f"{endpoints.__name__}.create_streamable"
        ),
    )


class TestVideoThumbnails:
    """Test that video thumbnail streams are stored under their own widths."""

    @pytest.mark.asyncio
    async def test_store_distinct_variants(
        self,
        config: ConfigForTests,
        create_uav_params: CreateUavParams,
        mock_transcoder_client: MockedTranscoderClient,
        faker: Faker,
    ) -> None:
        """Consume and store the distinct bytes returned for each resolution.

        Args:
            config: The mocked storage configuration.
            create_uav_params: Common upload parameters.
            mock_transcoder_client: The mocked transcoder functions.
            faker: The fixture generating thumbnail contents.
        """
        contents = {width: faker.binary(100) for width in (128, 256, 384)}
        stored: dict[ObjectRef, bytes] = {}
        create_uav_params.mock_fill_metadata.return_value = (
            create_uav_params.mock_metadata
        )

        async def thumbnail_stream(
            video: ObjectRef, chunk_size: int, thumbnail_width: int
        ) -> AsyncIterable[bytes]:
            """Yield a unique thumbnail in multiple transport chunks.

            Args:
                video: The source video reference.
                chunk_size: The requested streaming chunk size.
                thumbnail_width: The requested horizontal resolution.

            Yields:
                A portion of the encoded thumbnail.
            """
            image = contents[thumbnail_width]
            yield image[:50]
            yield image[50:]

        async def store_object(
            object_id: ObjectRef,
            *,
            data: UploadFile | AsyncIterable[bytes],
        ) -> None:
            """Consume thumbnail streams as a real object store would.

            Args:
                object_id: The destination object reference.
                data: The original upload or a generated thumbnail stream.
            """
            if isinstance(data, UploadFile):
                return
            stored[object_id] = b"".join([chunk async for chunk in data])

        mock_transcoder_client.mock_create_thumbnail.side_effect = (
            thumbnail_stream
        )
        config.mock_object_store.create_object.side_effect = store_object
        response = await endpoints.create_uav_video(
            metadata=UavVideoMetadata(),
            video_data=create_uav_params.mock_file,
            object_store=config.mock_object_store,
            metadata_store=config.mock_metadata_store,
            bucket=create_uav_params.bucket_id,
            background_tasks=create_uav_params.mock_background_tasks,
        )

        assert stored == {
            derived_id(response.video_id, "thumbnail", scale=width): data
            for width, data in contents.items()
        }


@pytest.mark.asyncio
async def test_create_uav_video(
    config: ConfigForTests,
    create_uav_params: CreateUavParams,
    mock_transcoder_client: MockedTranscoderClient,
) -> None:
    """
    Tests that `create_uav_video` works.

    Args:
        config: The configuration to use for testing.
        create_uav_params: Common parameters for testing this endpoint.
        mock_transcoder_client: The mocked `transcoder_client` functions.

    """
    # Arrange.
    # Make it look like it can fill the metadata.
    create_uav_params.mock_fill_metadata.return_value = (
        create_uav_params.mock_metadata
    )

    empty_metadata = UavVideoMetadata()

    # Act.
    response = await endpoints.create_uav_video(
        metadata=empty_metadata,
        video_data=create_uav_params.mock_file,
        object_store=config.mock_object_store,
        metadata_store=config.mock_metadata_store,
        bucket=create_uav_params.bucket_id,
        background_tasks=create_uav_params.mock_background_tasks,
    )

    # Run the background tasks.
    assert create_uav_params.mock_background_tasks.add_task.call_count == 2
    tasks = [
        c.args[0]
        for c in create_uav_params.mock_background_tasks.add_task.call_args_list
    ]
    for task in tasks:
        await task()

    # Assert.
    # It should have named the object correctly.
    got_video_id = response.video_id
    assert got_video_id.bucket == create_uav_params.bucket_id
    assert got_video_id.name.endswith(
        create_uav_params.mock_uuid.return_value.hex
    )

    # It should have updated the databases.
    assert config.mock_object_store.create_object.call_count == 6
    config.mock_object_store.create_object.assert_any_call(
        got_video_id, data=create_uav_params.mock_file
    )
    config.mock_metadata_store.add.assert_called_once_with(
        object_id=got_video_id, metadata=create_uav_params.mock_metadata
    )

    # It should have filled the metadata.
    create_uav_params.mock_fill_metadata.assert_called_once_with(
        empty_metadata,
        video=create_uav_params.mock_file,
        saved_video=got_video_id,
    )

    # It should have created the thumbnail.
    assert mock_transcoder_client.mock_create_thumbnail.call_count == 3
    mock_thumbnail = mock_transcoder_client.mock_create_thumbnail.return_value
    for width in (128, 256, 384):
        mock_transcoder_client.mock_create_thumbnail.assert_any_call(
            got_video_id,
            chunk_size=ObjectStore.UPLOAD_CHUNK_SIZE,
            thumbnail_width=width,
        )
        config.mock_object_store.create_object.assert_any_call(
            derived_id(got_video_id, "thumbnail", scale=width),
            data=mock_thumbnail,
        )

    # It should have created the preview.
    mock_transcoder_client.mock_create_preview.assert_called_once_with(
        got_video_id, chunk_size=mock.ANY
    )
    mock_preview = mock_transcoder_client.mock_create_preview.return_value
    config.mock_object_store.create_object.assert_any_call(
        ObjectRef(
            bucket=got_video_id.bucket, name=f"{got_video_id.name}.preview"
        ),
        data=mock_preview,
    )

    # It should have created the streaming version.
    mock_transcoder_client.mock_create_preview.assert_called_once_with(
        got_video_id, chunk_size=mock.ANY
    )
    mock_preview = mock_transcoder_client.mock_create_streamable.return_value
    config.mock_object_store.create_object.assert_any_call(
        ObjectRef(
            bucket=got_video_id.bucket, name=f"{got_video_id.name}.streamable"
        ),
        data=mock_preview,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "exception",
    (MetadataOperationError,),
    ids=("metadata_failure",),
)
async def test_create_uav_video_write_failure(
    config: ConfigForTests,
    create_uav_params: CreateUavParams,
    exception: Type[Exception],
) -> None:
    """
    Tests that `create_uav_video` handles it when a database write fails.

    Args:
        config: The configuration to use for testing.
        create_uav_params: Common parameters for testing this endpoint.
        exception: The specific failure mode to test.

    """
    # Arrange.
    # Make it look like the operations failed.
    config.mock_metadata_store.add.side_effect = exception

    # Act and assert.
    with pytest.raises(exception):
        await endpoints.create_uav_video(
            metadata=create_uav_params.mock_metadata,
            video_data=create_uav_params.mock_file,
            object_store=config.mock_object_store,
            metadata_store=config.mock_metadata_store,
            bucket=create_uav_params.bucket_id,
        )

    # Assert
    # It should have deleted the object.
    config.mock_object_store.delete_object.assert_called_once()


@pytest.mark.asyncio
async def test_delete_videos(config: ConfigForTests, faker: Faker) -> None:
    """
    Tests that the `delete_videos` endpoint works.

    Args:
        config: The configuration to use for testing.
        faker: The fixture to use for generating fake data.

    """
    # Arrange.
    # Generate fake objects.
    num_to_delete = faker.random_int(min=1, max=10)
    object_refs = [faker.object_ref() for _ in range(num_to_delete)]

    # Act.
    await endpoints.delete_videos(
        videos=object_refs,
        object_store=config.mock_object_store,
        metadata_store=config.mock_metadata_store,
    )

    # Assert.
    # It should have deleted the corresponding items in both databases.
    # (There are one main artifact and 3 derived objects in the object store.)
    # Optional timestamps add a fourth derived object to clean up.
    # Three sized thumbnails must also be removed alongside the legacy one.
    assert (
        config.mock_object_store.delete_object.call_count == num_to_delete * 8
    )
    assert config.mock_metadata_store.delete.call_count == num_to_delete
    for object_ref in object_refs:
        config.mock_object_store.delete_object.assert_any_call(object_ref)
        config.mock_object_store.delete_object.assert_any_call(
            ObjectRef(
                bucket=object_ref.bucket, name=f"{object_ref.name}.thumbnail"
            )
        )
        config.mock_object_store.delete_object.assert_any_call(
            ObjectRef(
                bucket=object_ref.bucket, name=f"{object_ref.name}.preview"
            )
        )
        config.mock_object_store.delete_object.assert_any_call(
            derived_id(object_ref, "timestamps")
        )
        for width in (128, 256, 384):
            config.mock_object_store.delete_object.assert_any_call(
                derived_id(object_ref, "thumbnail", scale=width)
            )
        config.mock_metadata_store.delete.assert_any_call(object_ref)


@pytest.mark.asyncio
async def test_delete_videos_nonexistent(
    config: ConfigForTests, faker: Faker
) -> None:
    """
    Tests that the `delete_videos` endpoint handles the case where a video
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

    # Make it look like at least one video was not found.
    return_values = [mock.DEFAULT for _ in range(num_successful)] + [
        KeyError for _ in range(num_failed)
    ]
    config.mock_object_store.delete_object.side_effect = return_values
    config.mock_metadata_store.delete.side_effect = return_values

    # Act and assert.
    with pytest.raises(HTTPException) as error:
        await endpoints.delete_videos(
            videos=successful_objects + failed_objects,
            object_store=config.mock_object_store,
            metadata_store=config.mock_metadata_store,
        )

        # It should have specified the failed objects in the error message.
        error_message = str(error.value)
        for object_ref in failed_objects:
            assert object_ref.bucket in error_message
            assert object_ref.name in error_message


@pytest.mark.asyncio
async def test_delete_videos_other_error(config: ConfigForTests, faker: Faker):
    """
    Tests that the `delete_videos` endpoint handles the case where some
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
        await endpoints.delete_videos(
            videos=[object_id],
            object_store=config.mock_object_store,
            metadata_store=config.mock_metadata_store,
        )
        assert errors.value.subgroup(KeyError) is not None

    config.mock_object_store.delete_object.assert_called()


@pytest.mark.asyncio
class TestTimestamps:
    """Tests timestamp storage, retrieval, validation, and video cleanup."""

    @pytest.fixture(autouse=True)
    def video_metadata(self, config: ConfigForTests, faker: Faker) -> None:
        """Configures stored metadata matching the four-frame timestamp fixture.

        Args:
            config: The mocked endpoint dependencies.
            faker: The fixture used to generate saved video metadata.
        """
        config.mock_metadata_store.get.return_value = (
            faker.video_metadata().model_copy(update={"num_frames": 4})
        )

    @pytest.fixture
    def timestamp_data(self, faker: Faker) -> bytes:
        """Generates valid timestamp data while preserving decimal precision.

        Args:
            faker: The fixture used to generate a starting timestamp.

        Returns:
            A timestamp file with four frame and timestamp pairs.
        """
        timestamp = faker.unix_time()
        return "".join(
            f"{frame} {timestamp}.{frame:09d}\n" for frame in range(4)
        ).encode("ascii")

    @pytest.mark.parametrize("line_ending", [b"\n", b"\r\n", b""])
    async def test_create(
        self,
        config: ConfigForTests,
        faker: Faker,
        timestamp_data: bytes,
        line_ending: bytes,
    ) -> None:
        """Stores unchanged bytes, including CRLF or a missing final newline.

        Args:
            config: The mocked endpoint dependencies.
            faker: The fixture used to generate the video reference.
            timestamp_data: The valid timestamp file contents.
            line_ending: The final line ending to test.
        """
        video_id = faker.object_ref()
        data = timestamp_data.rstrip(b"\n").replace(b"\n", b"\r\n")
        data += line_ending
        upload = UploadFile(file=BytesIO(data), filename="timestamps.txt")

        timestamp_id = await endpoints.create_timestamps(
            bucket=video_id.bucket,
            name=video_id.name,
            timestamp_data=upload,
            object_store=config.mock_object_store,
            metadata_store=config.mock_metadata_store,
        )

        assert timestamp_id == derived_id(video_id, "timestamps")
        config.mock_object_store.object_exists.assert_awaited_once_with(
            video_id
        )
        config.mock_object_store.create_object.assert_awaited_once_with(
            timestamp_id, data=upload
        )
        config.mock_metadata_store.get.assert_awaited_once_with(video_id)
        # Validation must rewind the file so storage receives every byte.
        assert await upload.read() == data

    @pytest.mark.parametrize(
        ("num_frames", "accepted"),
        [
            (None, True),
            (0, False),
            (1, False),
            (3, False),
            (4, True),
            (5, False),
        ],
    )
    async def test_create_frame_count(
        self,
        config: ConfigForTests,
        faker: Faker,
        timestamp_data: bytes,
        num_frames: int | None,
        accepted: bool,
    ) -> None:
        """Validates timestamp row counts against the stored video metadata.

        Args:
            config: The mocked endpoint dependencies.
            faker: The fixture used to generate the video reference.
            timestamp_data: The four-frame timestamp file contents.
            num_frames: The stored video frame count, if available.
            accepted: Whether the timestamp file should be accepted.
        """
        video_id = faker.object_ref()
        config.mock_metadata_store.get.return_value = (
            faker.video_metadata().model_copy(
                update={"num_frames": num_frames}
            )
        )
        upload = UploadFile(
            file=BytesIO(timestamp_data), filename="timestamps.txt"
        )
        create = endpoints.create_timestamps(
            bucket=video_id.bucket,
            name=video_id.name,
            timestamp_data=upload,
            object_store=config.mock_object_store,
            metadata_store=config.mock_metadata_store,
        )
        if accepted:
            timestamp_id = await create
            assert timestamp_id == derived_id(video_id, "timestamps")
            config.mock_object_store.create_object.assert_awaited_once_with(
                timestamp_id, data=upload
            )
            assert await upload.read() == timestamp_data
        else:
            with pytest.raises(HTTPException) as error:
                await create
            assert error.value.status_code == 415
            config.mock_object_store.create_object.assert_not_awaited()
        config.mock_metadata_store.get.assert_awaited_once_with(video_id)

    async def test_create_missing_metadata(
        self, config: ConfigForTests, faker: Faker, timestamp_data: bytes
    ) -> None:
        """Rejects uploads whose source video metadata cannot be loaded.

        Args:
            config: The mocked endpoint dependencies.
            faker: The fixture used to generate the video reference.
            timestamp_data: The valid timestamp file contents.
        """
        video_id = faker.object_ref()
        config.mock_metadata_store.get.side_effect = KeyError(video_id)
        upload = UploadFile(
            file=BytesIO(timestamp_data), filename="timestamps.txt"
        )
        with pytest.raises(HTTPException) as error:
            await endpoints.create_timestamps(
                bucket=video_id.bucket,
                name=video_id.name,
                timestamp_data=upload,
                object_store=config.mock_object_store,
                metadata_store=config.mock_metadata_store,
            )
        assert error.value.status_code == 404
        config.mock_object_store.create_object.assert_not_awaited()

    @pytest.mark.parametrize(
        "data",
        [
            b"",
            b"\n",
            b"0\n",
            b"0 1.0 extra\n",
            b"frame timestamp\n",
            b"0.0 1.0\n",
            b"-1 1.0\n",
            b"0 nan\n",
            b"0 inf\n",
            b"0 -inf\n",
            b"0 1e999\n",
            b"0 \xff\n",
            b"0 1.0\ninvalid later row\n",
        ],
    )
    async def test_invalid_data(
        self, config: ConfigForTests, faker: Faker, data: bytes
    ) -> None:
        """Rejects invalid files before writing to the object store.

        Args:
            config: The mocked endpoint dependencies.
            faker: The fixture used to generate the video reference.
            data: Invalid timestamp file contents.
        """
        video_id = faker.object_ref()
        upload = UploadFile(file=BytesIO(data), filename="timestamps.txt")
        with pytest.raises(HTTPException) as error:
            await endpoints.create_timestamps(
                bucket=video_id.bucket,
                name=video_id.name,
                timestamp_data=upload,
                object_store=config.mock_object_store,
                metadata_store=config.mock_metadata_store,
            )
        assert error.value.status_code == 415
        config.mock_object_store.create_object.assert_not_awaited()

    @pytest.mark.parametrize("filename", [None, "timestamps.csv"])
    async def test_invalid_filename(
        self,
        config: ConfigForTests,
        faker: Faker,
        timestamp_data: bytes,
        filename: str | None,
    ) -> None:
        """Requires uploads to have a .txt filename.

        Args:
            config: The mocked endpoint dependencies.
            faker: The fixture used to generate the video reference.
            timestamp_data: The valid timestamp file contents.
            filename: The invalid filename to test.
        """
        video_id = faker.object_ref()
        upload = UploadFile(file=BytesIO(timestamp_data), filename=filename)
        with pytest.raises(HTTPException) as error:
            await endpoints.create_timestamps(
                bucket=video_id.bucket,
                name=video_id.name,
                timestamp_data=upload,
                object_store=config.mock_object_store,
                metadata_store=config.mock_metadata_store,
            )
        assert error.value.status_code == 415
        config.mock_object_store.create_object.assert_not_awaited()

    async def test_missing_video(
        self, config: ConfigForTests, faker: Faker, timestamp_data: bytes
    ) -> None:
        """Does not create timestamps without a corresponding video.

        Args:
            config: The mocked endpoint dependencies.
            faker: The fixture used to generate the video reference.
            timestamp_data: The valid timestamp file contents.
        """
        video_id = faker.object_ref()
        config.mock_object_store.object_exists.return_value = False
        upload = UploadFile(
            file=BytesIO(timestamp_data), filename="timestamps.txt"
        )
        with pytest.raises(HTTPException) as error:
            await endpoints.create_timestamps(
                bucket=video_id.bucket,
                name=video_id.name,
                timestamp_data=upload,
                object_store=config.mock_object_store,
                metadata_store=config.mock_metadata_store,
            )
        assert error.value.status_code == 404
        config.mock_object_store.create_object.assert_not_awaited()

    @pytest.mark.parametrize(
        ("suffix", "stem_suffix"),
        [(".mp4", ""), (".webm", ""), ("", ""), (".part.mp4", ".part")],
    )
    async def test_get(
        self,
        config: ConfigForTests,
        faker: Faker,
        timestamp_data: bytes,
        suffix: str,
        stem_suffix: str,
    ) -> None:
        """Streams the stored bytes with a filename based on video metadata.

        Args:
            config: The mocked endpoint dependencies.
            faker: The fixture used to generate the video reference.
            timestamp_data: The valid timestamp file contents.
            suffix: The suffix appended to the original video's filename.
            stem_suffix: The part of the suffix retained in the download name.
        """
        video_id = faker.object_ref()
        video_stem = f"Flight {faker.word()}"
        metadata = faker.video_metadata().model_copy(
            update={"name": f"{video_stem}{suffix}"}
        )
        config.mock_metadata_store.get.return_value = metadata
        config.mock_object_store.get_object.return_value = iter(
            [timestamp_data]
        )
        config.mock_streaming_response_class.side_effect = StreamingResponse
        response = await endpoints.get_timestamps(
            bucket=video_id.bucket,
            name=video_id.name,
            object_store=config.mock_object_store,
            metadata_store=config.mock_metadata_store,
        )
        config.mock_object_store.get_object.assert_awaited_once_with(
            derived_id(video_id, "timestamps")
        )
        config.mock_metadata_store.get.assert_awaited_once_with(video_id)
        assert response.media_type == "text/plain"
        assert response.headers["Content-Disposition"] == (
            f'attachment; filename="{video_stem}{stem_suffix}_ts.txt"'
        )
        assert b"".join([chunk async for chunk in response.body_iterator]) == (
            timestamp_data
        )

    async def test_get_missing_metadata(
        self, config: ConfigForTests, faker: Faker
    ) -> None:
        """Reports missing source video metadata as HTTP 404.

        Args:
            config: The mocked endpoint dependencies.
            faker: The fixture used to generate the video reference.
        """
        video_id = faker.object_ref()
        config.mock_metadata_store.get.side_effect = KeyError(video_id)
        with pytest.raises(HTTPException) as error:
            await endpoints.get_timestamps(
                bucket=video_id.bucket,
                name=video_id.name,
                object_store=config.mock_object_store,
                metadata_store=config.mock_metadata_store,
            )
        assert error.value.status_code == 404
        config.mock_metadata_store.get.assert_awaited_once_with(video_id)
        config.mock_streaming_response_class.assert_not_called()

    async def test_head(self, config: ConfigForTests, faker: Faker) -> None:
        """Returns an empty success response without downloading timestamps.

        Args:
            config: The mocked endpoint dependencies.
            faker: The fixture used to generate the video reference.
        """
        video_id = faker.object_ref()
        config.mock_object_store.object_exists.return_value = True

        response = await endpoints.head_timestamps(
            bucket=video_id.bucket,
            name=video_id.name,
            object_store=config.mock_object_store,
        )

        assert response.status_code == 200
        assert response.body == b""
        config.mock_object_store.object_exists.assert_awaited_once_with(
            derived_id(video_id, "timestamps")
        )
        # HEAD must not open a download stream, even when timestamps exist.
        config.mock_object_store.get_object.assert_not_called()
        config.mock_streaming_response_class.assert_not_called()

    async def test_head_missing_timestamps(
        self, config: ConfigForTests, faker: Faker
    ) -> None:
        """Reports missing timestamps without attempting to download them.

        Args:
            config: The mocked endpoint dependencies.
            faker: The fixture used to generate the video reference.
        """
        video_id = faker.object_ref()
        config.mock_object_store.object_exists.return_value = False

        with pytest.raises(HTTPException) as error:
            await endpoints.head_timestamps(
                bucket=video_id.bucket,
                name=video_id.name,
                object_store=config.mock_object_store,
            )

        assert error.value.status_code == 404
        config.mock_object_store.object_exists.assert_awaited_once_with(
            derived_id(video_id, "timestamps")
        )
        config.mock_object_store.get_object.assert_not_called()
        config.mock_streaming_response_class.assert_not_called()

    async def test_delete(self, config: ConfigForTests, faker: Faker) -> None:
        """Deletes only the timestamps, leaving the source video untouched.

        Args:
            config: The mocked endpoint dependencies.
            faker: The fixture used to generate the video reference.
        """
        video_id = faker.object_ref()
        await endpoints.delete_timestamps(
            bucket=video_id.bucket,
            name=video_id.name,
            object_store=config.mock_object_store,
        )
        config.mock_object_store.delete_object.assert_awaited_once_with(
            derived_id(video_id, "timestamps")
        )
        config.mock_metadata_store.delete.assert_not_awaited()

    @pytest.mark.parametrize("operation", ["get", "delete"])
    async def test_missing_timestamps(
        self, config: ConfigForTests, faker: Faker, operation: str
    ) -> None:
        """Reports missing timestamp files as HTTP 404.

        Args:
            config: The mocked endpoint dependencies.
            faker: The fixture used to generate the video reference.
            operation: The endpoint operation to exercise.
        """
        video_id = faker.object_ref()
        getattr(
            config.mock_object_store, f"{operation}_object"
        ).side_effect = KeyError
        metadata_kwargs = (
            {"metadata_store": config.mock_metadata_store}
            if operation == "get"
            else {}
        )
        with pytest.raises(HTTPException) as error:
            await getattr(endpoints, f"{operation}_timestamps")(
                bucket=video_id.bucket,
                name=video_id.name,
                object_store=config.mock_object_store,
                **metadata_kwargs,
            )
        assert error.value.status_code == 404

    async def test_delete_video_without_timestamps(
        self, config: ConfigForTests, faker: Faker
    ) -> None:
        """Allows deletion of videos that have no optional timestamp file.

        Args:
            config: The mocked endpoint dependencies.
            faker: The fixture used to generate the video reference.
        """
        video_id = faker.object_ref()
        timestamp_id = derived_id(video_id, "timestamps")

        async def delete_object(object_id: ObjectRef) -> None:
            """Simulates a missing timestamp file in the object store.

            Args:
                object_id: The object to delete.
            """
            if object_id == timestamp_id:
                raise KeyError(object_id)

        config.mock_object_store.delete_object.side_effect = delete_object
        await endpoints.delete_videos(
            videos=[video_id],
            object_store=config.mock_object_store,
            metadata_store=config.mock_metadata_store,
        )
        config.mock_object_store.delete_object.assert_any_await(video_id)
        config.mock_object_store.delete_object.assert_any_await(timestamp_id)
        config.mock_metadata_store.delete.assert_awaited_once_with(video_id)


@pytest.mark.asyncio
async def test_get_video(config: ConfigForTests, faker: Faker) -> None:
    """
    Tests that the `get_video` endpoint works.

    Args:
        config: The configuration to use for testing.
        faker: The fixture to use for generating fake data.

    """
    # Arrange.
    # Make it look like we have a valid image format.
    metadata = faker.video_metadata()
    config.mock_metadata_store.get.return_value = metadata
    # Stored bytes, not potentially stale metadata, determine response length.
    stream_size = metadata.size + 1
    config.mock_object_store.get_object.return_value.__len__.return_value = (
        stream_size
    )

    # Generate fake bucket and image names.
    bucket = faker.pystr()
    image_name = faker.pystr()

    # Act.
    response = await endpoints.get_video(
        bucket=bucket,
        name=image_name,
        object_store=config.mock_object_store,
        metadata_store=config.mock_metadata_store,
    )

    # Assert.
    # It should have gotten the video.
    object_id = ObjectRef(bucket=bucket, name=image_name)
    config.mock_object_store.get_object.assert_called_once_with(object_id)
    video_stream = config.mock_object_store.get_object.return_value

    # It should have used a StreamingResponse object.
    config.mock_streaming_response_class.assert_called_once_with(
        video_stream, media_type=mock.ANY, headers=mock.ANY
    )

    # Check the headers.
    _, response_kwargs = config.mock_streaming_response_class.call_args
    headers = response_kwargs["headers"]
    assert headers["Content-Length"] == str(stream_size)
    assert "attachment" in headers["Content-Disposition"]
    assert metadata.name in headers["Content-Disposition"]

    assert response == config.mock_streaming_response_class.return_value


@pytest.mark.asyncio
async def test_get_video_nonexistent(
    config: ConfigForTests, faker: Faker
) -> None:
    """
    Tests that the `get_video` endpoint handles the case where the video does
    not exist.

    Args:
        config: The configuration to use for testing.
        faker: The fixture to use for generating fake data.

    """
    # Arrange.
    # Generate fake bucket and image names.
    bucket = faker.pystr()
    video_name = faker.pystr()

    # Make it look like the image doesn't exist.
    config.mock_object_store.get_object.side_effect = KeyError

    # Act and assert.
    with pytest.raises(HTTPException):
        await endpoints.get_video(
            bucket=bucket,
            name=video_name,
            object_store=config.mock_object_store,
            metadata_store=config.mock_metadata_store,
        )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "endpoint",
    [endpoints.get_preview, endpoints.get_streamable],
    ids=["preview", "streamable"],
)
async def test_get_transcoded(
    config: ConfigForTests,
    faker: Faker,
    endpoint: Callable[[str, str, ObjectStore], Awaitable[StreamingResponse]],
) -> None:
    """
    Tests that the `get_preview` and `get_streamable` endpoints works.

    Args:
        config: The configuration to use for testing.
        faker: The fixture to use for generating fake data.
        endpoint: The endpoint to test.

    """
    # Arrange.
    # Generate fake bucket and image names.
    bucket = faker.pystr()
    video_name = faker.pystr()

    stream = config.mock_object_store.get_object.return_value
    stream_size = faker.pyint(min_value=1)
    stream.__len__.return_value = stream_size
    config.mock_streaming_response_class.side_effect = StreamingResponse

    # Act.
    response = await endpoint(
        bucket=bucket,
        name=video_name,
        object_store=config.mock_object_store,
    )

    # Assert.
    # It should have gotten the video.
    config.mock_object_store.get_object.assert_called_once()
    args, _ = config.mock_object_store.get_object.call_args
    preview_id = args[0]
    assert preview_id.bucket == bucket
    # The name for this object should be distinct from that of the raw artifact.
    assert preview_id.name != video_name
    video_stream = config.mock_object_store.get_object.return_value

    # It should have used a StreamingResponse object.
    assert response.media_type == "video/webm"
    assert response.status_code == 200
    assert response.headers["Content-Length"] == str(stream_size)
    assert response.headers["Accept-Ranges"] == "bytes"
    assert "Content-Range" not in response.headers
    assert video_stream is stream


@pytest.mark.asyncio
class TestVideoRanges:
    """Tests partial responses and backend-neutral range failures."""

    @pytest.mark.parametrize("partial", [False, True])
    async def test_range_response(
        self,
        config: ConfigForTests,
        faker: Faker,
        mocker: MockFixture,
        partial: bool,
    ) -> None:
        """Returns 206 for partial data or 200 when a backend ignores Range.

        Args:
            config: The mocked endpoint dependencies.
            faker: The fixture used to generate response bytes.
            mocker: The fixture used to create a contract-compatible stream.
            partial: Whether the backend honors the requested range.
        """
        video_id = faker.object_ref()
        data = faker.binary(length=16)
        stream = mocker.create_autospec(ObjectStream, instance=True)
        stream.__len__.return_value = len(data)
        stream.__aiter__.return_value = [data]
        stream.content_range = "bytes 0-15/32" if partial else None
        config.mock_object_store.get_object.return_value = stream
        config.mock_streaming_response_class.side_effect = StreamingResponse

        response = await endpoints.get_streamable(
            bucket=video_id.bucket,
            name=video_id.name,
            object_store=config.mock_object_store,
            range_header="bytes=0-15",
        )

        config.mock_object_store.get_object.assert_awaited_once_with(
            derived_id(video_id, "streamable"), data_range="bytes=0-15"
        )
        assert response.status_code == (206 if partial else 200)
        assert response.headers["Content-Length"] == str(len(data))
        assert response.headers.get("Content-Range") == stream.content_range
        assert (
            b"".join([chunk async for chunk in response.body_iterator]) == data
        )

    async def test_unsatisfiable_range(
        self, config: ConfigForTests, faker: Faker
    ) -> None:
        """Maps a storage range error to HTTP 416 before starting a response.

        Args:
            config: The mocked endpoint dependencies.
            faker: The fixture used to generate the video reference.
        """
        video_id = faker.object_ref()
        config.mock_object_store.get_object.side_effect = InvalidRangeError

        with pytest.raises(HTTPException) as error:
            await endpoints.get_streamable(
                bucket=video_id.bucket,
                name=video_id.name,
                object_store=config.mock_object_store,
                range_header="bytes=1024-",
            )

        assert error.value.status_code == 416
        config.mock_streaming_response_class.assert_not_called()


@pytest.mark.asyncio
async def test_get_preview_nonexistent(
    config: ConfigForTests, faker: Faker
) -> None:
    """
    Tests that the `get_preview` endpoint handles the case where the video
    does not exist.

    Args:
        config: The configuration to use for testing.
        faker: The fixture to use for generating fake data.

    """
    # Arrange.
    # Generate fake bucket and image names.
    bucket = faker.pystr()
    video_name = faker.pystr()

    # Make it look like the image doesn't exist.
    config.mock_object_store.get_object.side_effect = KeyError

    # Act and assert.
    with pytest.raises(HTTPException):
        await endpoints.get_preview(
            bucket=bucket,
            name=video_name,
            object_store=config.mock_object_store,
        )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "num_videos", [8, 1, 0], ids=["multiple", "single", "none"]
)
async def test_find_video_metadata(
    config: ConfigForTests, faker: Faker, num_videos: int
) -> None:
    """
    Tests that `find_video_metadata` works.

    Args:
        config: The configuration to use for testing.
        faker: The fixture to use for generating fake data.
        num_videos: The number of images to use for testing.

    """
    # Arrange.
    # Generate fake bucket and video names.
    object_refs = [faker.object_ref() for _ in range(num_videos)]

    # Make it look like it get valid metadata from the database.
    config.mock_metadata_store.get.return_value = faker.video_metadata()

    # Act.
    response = (
        await endpoints.find_video_metadata(
            videos=object_refs,
            metadata_store=config.mock_metadata_store,
        )
    ).metadata

    # Assert.
    # It should have gotten the metadata.
    assert config.mock_metadata_store.get.call_count == num_videos
    for object_id in object_refs:
        config.mock_metadata_store.get.assert_any_call(object_id)
    assert (
        response == [config.mock_metadata_store.get.return_value] * num_videos
    )


@pytest.mark.asyncio
async def test_find_video_metadata_nonexistent(
    config: ConfigForTests, faker: Faker
) -> None:
    """
    Tests that the `find_video_metadata` endpoint handles it correctly when
    the specified video does not exist.

    Args:
        config: The configuration to use for testing.
        faker: The fixture to use for generating fake data.

    """
    # Arrange.
    # Generate fake bucket and video names.
    existing_object_id = faker.object_ref()
    missing_object_id = faker.object_ref()
    object_refs = [existing_object_id, missing_object_id]

    # Make it look like one of the videos doesn't exist.
    config.mock_metadata_store.get.side_effect = [mock.DEFAULT, KeyError]

    # Act and assert.
    with pytest.raises(HTTPException) as exc_info:
        await endpoints.find_video_metadata(
            videos=object_refs,
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

    metadata = faker.video_metadata()

    # Act.
    await endpoints.batch_update_metadata(
        metadata=metadata,
        videos=object_ids,
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
        create_uav_params: Common parameters for testing video creation.

    """
    # Act.
    got_metadata = await endpoints.infer_video_metadata(
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
    mock_metadata = mocker.create_autospec(UavVideoMetadata, instance=True)
    mock_video_data = faker.upload_file()

    # Mock the underlying function that it calls.
    mock_fill_metadata = mocker.patch(endpoints.__name__ + ".fill_metadata")

    # Act.
    got_metadata = await endpoints.filled_uav_metadata(
        metadata=mock_metadata,
        video_data=mock_video_data,
    )

    # Assert.
    mock_fill_metadata.assert_called_once()
    assert got_metadata == mock_fill_metadata.return_value


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "error",
    [InvalidVideoError, MissingLengthError],
    ids=["invalid_video", "missing_length"],
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
    mock_metadata = mocker.create_autospec(UavVideoMetadata, instance=True)
    mock_image_data = faker.upload_file()

    # Mock the underlying function that it calls.
    mock_fill_metadata = mocker.patch(endpoints.__name__ + ".fill_metadata")
    mock_fill_metadata.side_effect = error

    # Act and assert.
    with pytest.raises(HTTPException):
        await endpoints.filled_uav_metadata(
            metadata=mock_metadata,
            video_data=mock_image_data,
        )
