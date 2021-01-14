"""
Tests for the `fastapi_utils` module.
"""


import inspect
import unittest.mock as mock

import pytest
from pydantic import BaseModel
from pydantic.dataclasses import dataclass
from pytest_mock import MockFixture

from mallard import fastapi_utils
from mallard.type_helpers import ArbitraryTypesConfig


@dataclass(frozen=True, config=ArbitraryTypesConfig)
class ConfigForTests:
    """
    Encapsulates standard configuration for most tests.

    Attributes:
        mock_depends: The mocked `FastAPI` `Depends` function.
        mock_form: The mocked `FastAPI` `Form` function.

    """

    mock_depends: mock.Mock
    mock_form: mock.Mock


@pytest.fixture
def config(mocker: MockFixture) -> ConfigForTests:
    """
    Generates standard configuration for tests.

    Args:
        mocker: The fixture to use for mocking.

    Returns:
        The configuration that it created.

    """
    # Mock the dependencies.
    mock_depends = mocker.patch(fastapi_utils.__name__ + ".Depends")
    mock_form = mocker.patch(fastapi_utils.__name__ + ".Form")

    return ConfigForTests(mock_depends=mock_depends, mock_form=mock_form)


@pytest.mark.asyncio
async def test_as_form(config: ConfigForTests) -> None:
    """
    Tests that `as_form` works normally.

    Args:
        config: The configuration to use for testing.

    """
    # Arrange.
    # Create a testing model class.
    class TestModel(BaseModel):
        foo: int
        bar: str
        baz: float

    # Act.
    # Apply the decorator.
    decorated_class = fastapi_utils.as_form(TestModel)

    # Assert.
    # It should have added the method.
    assert hasattr(decorated_class, "as_form")

    # The method should have the correct signature.
    signature = inspect.signature(decorated_class.as_form)
    for param in signature.parameters.values():
        assert param.default == config.mock_form.return_value

    # The method should work.
    model = await decorated_class.as_form(foo=42, bar="hello", baz=3.14)
    assert model.foo == 42
    assert model.bar == "hello"
    assert model.baz == 3.14


@pytest.mark.asyncio
async def test_as_form_nested(config: ConfigForTests) -> None:
    """
    Tests that `as_form` works with nested models.

    Args:
        config: The configuration to use for testing.

    """
    # Arrange.
    # Create the testing model classes.
    @fastapi_utils.as_form
    class Inner(BaseModel):
        foo: int
        bar: str

    class TestModel(BaseModel):
        inner: Inner
        baz: float

    # Act.
    # Apply the decorator.
    decorated_class = fastapi_utils.as_form(TestModel)

    # Assert.
    # It should have added the method.
    assert hasattr(decorated_class, "as_form")

    # The method should have the correct signature.
    signature = inspect.signature(decorated_class.as_form)
    for name, param in signature.parameters.items():
        if name == "inner":
            # This should be the sub-model.
            assert param.default == config.mock_depends.return_value
        else:
            assert param.default == config.mock_form.return_value

    # It should have used the correct dependency.
    config.mock_depends.assert_called_once_with(Inner.as_form)

    # The method should work.
    model = await decorated_class.as_form(
        inner=Inner(foo=42, bar="hello"), baz=3.14
    )
    assert model.inner.foo == 42
    assert model.inner.bar == "hello"
    assert model.baz == 3.14


@pytest.mark.asyncio
async def test_as_form_defaults(config: ConfigForTests) -> None:
    """
    Tests that `as_form` works with default values.

    Args:
        config: The configuration to use for testing.

    """
    # Arrange.
    # Create the testing model class.
    class TestModel(BaseModel):
        no_default: int
        has_default: str = "default"

    # Act.
    # Apply the decorator.
    decorated_class = fastapi_utils.as_form(TestModel)

    # Assert.
    # It should have added the method.
    assert hasattr(decorated_class, "as_form")

    # The method should have the correct signature.
    signature = inspect.signature(decorated_class.as_form)
    for param in signature.parameters.values():
        assert param.default == config.mock_form.return_value

    # It should have specified the default value for the relevant parameter.
    assert config.mock_form.call_count == 2
    config.mock_form.assert_any_call(...)
    config.mock_form.assert_any_call("default")

    # The method should work.
    model = await decorated_class.as_form(no_default=42)
    assert model.no_default == 42
    assert model.has_default == "default"
