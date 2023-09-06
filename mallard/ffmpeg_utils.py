"""
Common utilities for FFMpeg.
"""


from typing import Any, Dict


def find_video_stream(ffprobe_results: Dict[str, Any]) -> Dict[str, Any]:
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

    raise KeyError("Video stream not found.")
