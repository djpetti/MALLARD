"""
Miscellaneous helper functions for FastAPI.
"""
import enum
import inspect
from typing import Any, Callable, Dict, Type, cast

from fastapi import Depends, Form
from pydantic import BaseModel
from pydantic.fields import Field, FieldInfo


def _safe_issubclass(value: Any, class_type: Type[Any]) -> bool:
    """
    A version of `issubclass` that doesn't throw an exception if we give it
    an input that's not a class instance.

    Args:
        value: The value to check.
        class_type: The base class type.

    Returns:
        True if `value` is a subclass of the `class_type`. It will also return
        false if `value` is not a class instance at all.

    """
    try:
        return issubclass(value, class_type)
    except TypeError:
        # Not a class instance
        return False


def as_form(cls: Type[BaseModel]) -> Type[BaseModel]:
    """
    Adds an `as_form` class method to decorated models. The `as_form` class
    method can be used with `FastAPI` endpoints.

    This is cribbed from
    https://github.com/tiangolo/fastapi/issues/2387, with modifications. Note
    that it should become obsolete as soon as this issue is formally resolved.

    Args:
        cls: The model class to decorate.

    Examples:
        Use with nested models:

        ```
        @as_form
        class Nested(BaseModel):
            foo: int
            bar: str

        @as_form
        class Outer(BaseModel):
            inner: Inner
            baz: float

        @app.post("/test")
        async def test_form(form: Outer = Depends(Outer.as_form)):
            return {"foo": form.inner.foo, "bar": form.inner.bar,
                    "baz": form.baz}
        ```

    Returns:
        The decorated class.

    """

    def make_form_parameter(name_: str, field_: FieldInfo) -> Any:
        """
        Converts a field from a `Pydantic` model to the appropriate `FastAPI`
        parameter type.

        Args:
            name_: The name of the field.
            field_: The field to convert.

        Returns:
            Either the result of `Form`, if the field is not a sub-model, or
            the result of `Depends` if it is.

        """
        if _safe_issubclass(field_.annotation, BaseModel):
            # This is a sub-model.
            assert hasattr(field_.annotation, "as_form"), (
                f"Sub-model class for {name_} field must be decorated with"
                f" `as_form` too."
            )
            return Depends(field_.annotation.as_form)
        else:
            # This is just a normal field.
            return (
                Form(field_.default) if not field_.is_required() else Form(...)
            )

    new_params = []
    for name, field in cls.model_fields.items():
        field = cast(FieldInfo, field)
        field_type = field.annotation
        if _safe_issubclass(field_type, enum.Enum):
            # FastAPI, unfortunately, does not seem to handle enums in form
            # parameters very well. To work around this, we can just ensure
            # that the enum type inherits from str and use str values.
            assert issubclass(
                field_type, str
            ), "Enums must also inherit from str when used in forms."
            field_type = str

        param = inspect.Parameter(
            name,
            inspect.Parameter.POSITIONAL_ONLY,
            default=make_form_parameter(name, field),
            annotation=field_type,
        )
        new_params.append(param)

    async def _as_form(**data):
        return cls(**data)

    sig = inspect.signature(_as_form)
    sig = sig.replace(parameters=new_params)
    _as_form.__signature__ = sig
    setattr(cls, "as_form", _as_form)
    return cls


def _key_prefix(parent: str, child: str) -> str:
    """
    A default key combination function that prefixes the child key with the
    parent one.

    Args:
        parent: The parent key.
        child: The child key.

    Returns:
        The combined keys.

    """
    return f"{parent}{child}"


def flatten_dict(
    nested: Dict[str, Any],
    combine_keys: Callable[[str, str], str] = _key_prefix,
) -> Dict[str, Any]:
    """
    Flattens a nested dictionary into a single dictionary.

    Args:
        nested: The dictionary to flatten.
        combine_keys: Function to use to combine keys from nested
            dictionaries with their parent keys in order to ensure that all
            keys in the flattened dictionary are unique.

    Returns:
        The flattened model as a dictionary.

    """

    def _flatten_dict(input_dict: dict, prefix: str) -> dict:
        flat = {}
        for param, value in input_dict.items():
            # Use the prefixed key.
            prefixed_key = combine_keys(prefix, param)

            if type(value) is dict:
                value = _flatten_dict(value, prefixed_key)
                flat.update(value)

            else:
                flat[prefixed_key] = value

        return flat

    return _flatten_dict(nested, "")
