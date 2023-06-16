"""
Handles parsing video metadata
"""


from datetime import datetime, timezone, tzinfo
from fractions import Fraction
from functools import cached_property
from typing import Any, Dict, TypeVar

from fastapi import UploadFile
from loguru import logger

from ...artifact_metadata import fill_metadata as artifact_fill_metadata
from ...backends.metadata.schemas import VideoFormat, VideoMetadata
from .transcoder_client import probe_video


class InvalidVideoError(Exception):
    """
    Raised when the video is invalid.
    """


class FFProbeReader:
    """
    Parses the output from `ffprobe` to extract video metadata.
    """

    _FFPROBE_FORMAT_CODES = {
        "h264": VideoFormat.AVC,
        "av1": VideoFormat.AV1,
        "h263": VideoFormat.H263,
        "hevc": VideoFormat.HEVC,
        "theora": VideoFormat.THEORA,
        "vp8": VideoFormat.VP8,
        "vp9": VideoFormat.VP9,
    }
    """
    Maps `codec_name` parameters from `ffprobe` to `VideoFormat` values.
    """

    def __init__(self, ffprobe_results: Dict[str, Any]):
        """
        Args:
            ffprobe_results: The JSON output from `ffprobe`.
        """
        self.__ffprobe_results = ffprobe_results
        self.__format = ffprobe_results["format"]
        self.__video_stream = self.__find_video_stream(ffprobe_results)

    @staticmethod
    def __find_video_stream(ffprobe_results: Dict[str, Any]) -> Dict[str, Any]:
        """
        Finds the video stream in the ffprobe results.

        Args:
            ffprobe_results: The ffprobe results.

        Returns:
            The video stream.

        """
        for stream in ffprobe_results["streams"]:
            if stream["codec_type"] == "video":
                return stream

        raise InvalidVideoError("Video stream not found.")

    @cached_property
    def capture_datetime(self) -> datetime:
        """
        Extracts the date and time at which this video was captured. Will
        fall back on the current date and time if it can't be found.

        Returns:
            The extracted date and time.

        """
        capture_time_tag = self.__format["tags"].get("creation_time")
        if capture_time_tag is None:
            logger.warning("Video capture time not found, using current time.")
            return datetime.now(timezone.utc)

        capture_time = datetime.fromisoformat(capture_time_tag)

    @cached_property
    def format(self) -> VideoFormat:
        """
        Extracts the video format.

        Returns:
            The extracted video format.

        """
        codec_name = self.__video_stream["codec_name"]
        video_format = FFProbeReader._FFPROBE_FORMAT_CODES.get(codec_name)
        if video_format is None:
            raise InvalidVideoError(
                f"Got unknown video format '{codec_name}'."
            )

        return video_format

    @cached_property
    def frame_rate(self) -> float:
        """
        Extracts the frame rate.

        Returns:
            The extracted frame rate.

        """
        return float(Fraction(self.__video_stream["avg_frame_rate"]))

    @cached_property
    def num_frames(self) -> int:
        """
        Extracts the number of frames.

        Returns:
            The extracted number of frames.

        """
        return int(self.__video_stream["nb_frames"])


MetadataType = TypeVar("MetadataType", bound=VideoMetadata)


async def fill_metadata(
    metadata: MetadataType, *, video: UploadFile
) -> MetadataType:
    """
    Fills the video metadata.

    Args:
        metadata: The video metadata to fill in.
        video: The video file.

    Returns:
        The filled video metadata.

    """
    # Probe the video.
    probe_results = await probe_video(video)
    reader = FFProbeReader(probe_results)

    # Reset the video file after probing.
    await video.seek(0)

    if metadata.format is not None and metadata.format != reader.format:
        raise InvalidVideoError(
            f"Got video format '{reader.format}' but expected '{metadata.format}'."
        )

    return artifact_fill_metadata(
        metadata,
        artifact=video,
        capture_datetime=reader.capture_datetime,
        format=reader.format,
        frame_rate=reader.frame_rate,
        num_frames=reader.num_frames,
    )