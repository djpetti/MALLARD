"""
Miscellaneous helper functions for FastAPI.
"""


import inspect
from typing import Any, Type

from fastapi import Depends, Form
from pydantic import BaseModel
from pydantic.fields import ModelField


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

    def make_form_parameter(field: ModelField) -> Any:
        """
        Converts a field from a `Pydantic` model to the appropriate `FastAPI`
        parameter type.

        Args:
            field: The field to convert.

        Returns:
            Either the result of `Form`, if the field is not a sub-model, or
            the result of `Depends` if it is.

        """
        if issubclass(field.type_, BaseModel):
            # This is a sub-model.
            assert hasattr(field.type_, "as_form"), (
                f"Sub-model class for {field.name} field must be decorated with"
                f" `as_form` too."
            )
            return Depends(field.type_.as_form)
        else:
            return Form(field.default) if not field.required else Form(...)

    new_params = [
        inspect.Parameter(
            field.alias,
            inspect.Parameter.POSITIONAL_ONLY,
            default=make_form_parameter(field),
        )
        for field in cls.__fields__.values()
    ]

    async def _as_form(**data):
        return cls(**data)

    sig = inspect.signature(_as_form)
    sig = sig.replace(parameters=new_params)
    _as_form.__signature__ = sig
    setattr(cls, "as_form", _as_form)
    return cls
