"""
Tests for the `schemas` module.
"""


from typing import Callable, Generic, Optional, Type, TypeVar

import pytest
from faker import Faker
from pydantic import BaseModel

from mallard.gateway import schemas


class TestApiModel(schemas.ApiModel):
    """
    An `ApiModel` subclass to use for testing.
    """

    foo: int
    foo_bar: str
    foo_bar_baz: float


T = TypeVar("T")


class TestGenericApiModel(schemas.GenericApiModel, Generic[T]):
    """
    A `GenericApiModel` subclass to use for testing.
    """

    foo: int
    foo_bar: str
    foo_bar_baz: float

    generic: Optional[T] = None


ModelType = TypeVar("ModelType", bound=BaseModel)

ModelFactory = Callable[[Type[ModelType]], ModelType]
"""
Alias for a function that makes models. It takes the type of model to create
as an argument.
"""


@pytest.fixture()
def model_factory(faker: Faker) -> ModelFactory:
    """
    Fixture for creating models.

    Args:
        faker: The fixture to use for generating fake data.

    Returns:
        The model factory.

    """

    def _model_factory_impl(model_type: Type[ModelType]) -> ModelType:
        return model_type(
            foo=faker.random_int(),
            foo_bar=faker.pystr(),
            foo_bar_baz=faker.pyfloat(),
        )

    return _model_factory_impl


@pytest.mark.parametrize(
    "model_class",
    [TestApiModel, TestGenericApiModel],
    ids=("normal", "generic"),
)
def test_json(
    model_class: Type[ModelType], model_factory: ModelFactory
) -> None:
    """
    Tests that we can successfully convert a model to JSON.

    Args:
        model_class: The model class to test.
        model_factory: The factory to use for creating test models.

    """
    # Arrange.
    test_model = model_factory(model_class)

    # Act.
    json_original = test_model.json(by_alias=False)
    json_camel = test_model.json()

    # Assert.
    # By default, it should use aliases for the export.
    assert json_original != json_camel

    # Furthermore, all keys should be in camel case.
    assert "_" not in json_camel


@pytest.mark.integration
@pytest.mark.parametrize(
    "model_class",
    [TestApiModel, TestGenericApiModel],
    ids=("normal", "generic"),
)
def test_json_round_trip(
    model_class: Type[ModelType], model_factory: ModelFactory
) -> None:
    """
    Tests that we can convert to JSON and then parse it back into the same
    model.

    Args:
        model_class: The model class to test.
        model_factory: The factory to use for creating test models.

    """
    # Arrange.
    test_model = model_factory(model_class)

    # Act.
    model_json = test_model.json()
    new_model = model_class.parse_raw(model_json)

    # Assert.
    # The two models should be the same.
    assert new_model == test_model
