"""
Handles dependency injection for backends.

The public API is meant to be used as an argument for `Depends`:

```
@app.get("/test")
async def get_test(
    object_store = Depends(object_store)
):
    ...
```
"""


import importlib
import re
from contextlib import asynccontextmanager
from functools import cache
from typing import AsyncIterator, Type, TypeVar

from confuse import ConfigTypeError, ConfigView
from loguru import logger

from ...config import config
from .injectable import Injectable
from .metadata import RasterMetadataStore
from .objects import ObjectStore

_IMPORT_RE = re.compile(r"(?P<module>.+)\.(?P<class>\w+)")
"""
Regular expression to use for distinguishing the module and class parts
of an import statement.
"""


DepType = TypeVar("DepType", bound=Injectable)


@cache
def _import_class(class_path: str) -> Type:
    """
    Dynamically imports class.

    Args:
        class_path: The full, dotted import path for the class, such as
            would be used in an `import` statement.

    Raises:
        `ConfigTypeError` if `class_path` is invalid.

    Returns:
        The class that it loaded.

    """
    # Split the class and module portions.
    match = _IMPORT_RE.fullmatch(class_path)
    if match is None:
        raise ConfigTypeError(
            f"Class specification '{class_path}' in " f"config is not valid."
        )
    class_name = match.group("class")
    module_path = match.group("module")

    logger.debug("Got module {} and class {}.", module_path, class_name)

    # Load the class.
    module = importlib.import_module(module_path)
    if not hasattr(module, class_name):
        raise ConfigTypeError(
            f"Class {class_name} does not exist in " f"module {module_path}."
        )
    return getattr(module, class_name)


@asynccontextmanager
async def _load_dependency(
    view: ConfigView, *, check_type: Type[DepType]
) -> AsyncIterator[DepType]:
    """
    Loads a dependency based on the specification in a `ConfigView`.

    Args:
        view: The view containing the dependency specification.
        check_type: A superclass that the loaded dependency should
            conform to.

    Raises:
        `ConfigTypeError` if the loaded dependency is of the wrong type.

    Returns:
        The instance of the dependency that it loaded.

    """
    type_name = view["type"].as_str()
    logger.info("Loading dependency '{}'...", type_name)
    type_class = _import_class(view["type"].as_str())

    # Ensure that the type is correct.
    if not issubclass(type_class, check_type):
        raise ConfigTypeError(
            f"Expected a subclass of "
            f"{check_type.__name__}, but got "
            f"{type_class.__name__} instead."
        )

    # Initialize the new instance.
    async with type_class.from_config(view["config"]) as dependency:
        yield dependency


async def object_store() -> AsyncIterator[ObjectStore]:
    """
    Returns:
        The `ObjectStore` subclass to use.

    """
    async with _load_dependency(
        config["backends"]["object_store"], check_type=ObjectStore
    ) as store:
        yield store


async def image_metadata_store() -> AsyncIterator[RasterMetadataStore]:
    """
    Returns:
        The `MetadataStore` subclass to use.

    """
    async with _load_dependency(
        config["backends"]["image_metadata_store"],
        check_type=RasterMetadataStore,
    ) as store:
        yield store


async def video_metadata_store() -> AsyncIterator[RasterMetadataStore]:
    """
    Returns:
        The `MetadataStore` subclass to use.

    """
    async with _load_dependency(
        config["backends"]["video_metadata_store"],
        check_type=RasterMetadataStore,
    ) as store:
        yield store
