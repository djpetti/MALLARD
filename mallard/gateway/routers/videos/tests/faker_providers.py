"""
Custom faker providers for testing.
"""

from typing import Any, Dict

from faker import Faker
from faker.providers import BaseProvider


class VideoProvider(BaseProvider):
    """
    Provider for the video router tests.
    """

    _FFMPEG_FORMATS = ["h264", "h263", "hevc", "theora", "vp8", "vp9", "av1"]
    """
    Supported FFMpeg codecs.
    """

    def __init__(self, *args: Any, **kwargs: Any):
        super().__init__(*args, **kwargs)

        self.__faker = Faker()

    def ffprobe_results(self) -> Dict[str, Any]:
        """
        Generates a fake ffprobe results dictionary.
        """
        # Frame rate is typically expressed as a fraction.
        frame_rate_n = self.random_int(min=1, max=1000)
        frame_rate_d = self.random_int(min=1, max=1000)

        return {
            "streams": [
                {
                    "codec_type": "audio",
                    "codec_name": "aac",
                },
                {
                    "width": str(self.random_int(min=1, max=1000)),
                    "height": str(self.random_int(min=1, max=1000)),
                    "codec_type": "video",
                    "codec_name": self.random_element(self._FFMPEG_FORMATS),
                    "avg_frame_rate": f"{frame_rate_n}/{frame_rate_d}",
                    "nb_frames": str(self.random_int(min=1, max=10000)),
                },
            ],
            "format": {
                "tags": {
                    "creation_time": self.__faker.date_time_this_year().isoformat(),
                }
            },
        }
