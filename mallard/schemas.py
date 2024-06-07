"""
Schema definitions common to all locations.
"""


from typing import Any

from pydantic import BaseModel
from pydantic.generics import GenericModel


def _snake_to_camel_case(snake: str) -> str:
    """
    Converts a field name in snake case, i.e. `my_field`, to one in camel
    case, i.e. `myField`.

    Args:
        snake: The field name in snake case.

    Returns:
        The field name in camel case.

    """
    words = snake.split("_")
    first_word = words[0]
    other_words = "".join((word.capitalize() for word in words[1:]))
    return f"{first_word}{other_words}"


class _ApiModelConfig:
    """
    Default config class for ApiModels.
    """

    alias_generator = _snake_to_camel_case
    allow_population_by_field_name = True
    allow_mutation = False


class ApiModel(BaseModel):
    """
    Implements the default configuration for models that are used as part of
    the API.
    """

    Config = _ApiModelConfig

    def json(self, *args: Any, by_alias: bool = True, **kwargs: Any) -> str:
        return super().json(*args, by_alias=by_alias, **kwargs)


class GenericApiModel(GenericModel):
    Config = _ApiModelConfig

    def json(self, *args: Any, by_alias: bool = True, **kwargs: Any) -> str:
        return super().json(*args, by_alias=by_alias, **kwargs)
