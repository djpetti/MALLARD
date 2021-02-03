"""
Miscellaneous type aliases.
"""


from typing import Any


class ArbitraryTypesConfig:
    """
    Pydantic configuration class that allows for arbitrary types.
    """

    arbitrary_types_allowed = True


Request = Any
"""
Placeholder for the Pytest `Request` object.
"""
