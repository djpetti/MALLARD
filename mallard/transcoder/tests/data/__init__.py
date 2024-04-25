"""
Contains external data used by tests.
"""


from pathlib import Path

# Current directory we are in.
_CURRENT_DIR = Path(__file__).parent

BIG_BUCK_BUNNY_PATH = _CURRENT_DIR / "big_buck_bunny.mp4"
"""
Path to the Big Buck Bunny video.
"""
NON_STREAMABLE_PATH = _CURRENT_DIR / "non_streamable.mp4"
"""
Path to a video that does not have the MOOV atom at the beginning.
"""
