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
from contextlib import AsyncExitStack
from functools import cache
from typing import AsyncIterator, Type, TypeVar

from asyncstdlib.functools import cache as async_cache
from confuse import ConfigTypeError
from loguru import logger

from ...config import config
from .injectable import Injectable
from .metadata import ArtifactMetadataStore
from .objects import ObjectStore

_IMPORT_RE = re.compile(r"(?P<module>.+)\.(?P<class>\w+)")
"""
Regular expression to use for distinguishing the module and class parts
of an import statement.
"""


DepType = TypeVar("DepType", bound=Injectable)


_g_exit_stack = AsyncExitStack()
"""
This is used internally to manage dependencies.
"""


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
            f"Class specification '{class_path}' in config is not valid."
        )
    class_name = match.group("class")
    module_path = match.group("module")

    logger.debug("Got module {} and class {}.", module_path, class_name)

    # Load the class.
    module = importlib.import_module(module_path)
    if not hasattr(module, class_name):
        raise ConfigTypeError(
            f"Class {class_name} does not exist in module {module_path}."
        )
    return getattr(module, class_name)


@async_cache
async def _load_dependency(
    dependency_name: str, *, check_type: Type[DepType]
) -> AsyncIterator[DepType]:
    """
    Loads a dependency based on the specification in a `ConfigView`.

    Args:
        dependency_name: The name of the dependency to load. Should be a string
            separated by dots, as if you were importing a module. This will
            be used to read from the config view.
        check_type: A superclass that the loaded dependency should
            conform to.

    Raises:
        `ConfigTypeError` if the loaded dependency is of the wrong type.

    Returns:
        The instance of the dependency that it loaded.

    """
    view_sequence = dependency_name.split(".")
    view = config
    for view_name in view_sequence:
        view = view[view_name]
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
    return await _g_exit_stack.enter_async_context(
        type_class.from_config(view["config"])
    )


async def object_store() -> AsyncIterator[ObjectStore]:
    """
    Returns:
        The `ObjectStore` subclass to use.

    """
    return await _load_dependency(
        "backends.object_store", check_type=ObjectStore
    )


async def artifact_metadata_store() -> AsyncIterator[ArtifactMetadataStore]:
    """
    Returns:
        The `MetadataStore` subclass to use.

    """
    return await _load_dependency(
        "backends.artifact_metadata_store",
        check_type=ArtifactMetadataStore,
    )


async def image_metadata_store() -> AsyncIterator[ArtifactMetadataStore]:
    """
    Returns:
        The `MetadataStore` subclass to use.

    """
    return await _load_dependency(
        "backends.image_metadata_store",
        check_type=ArtifactMetadataStore,
    )


async def video_metadata_store() -> AsyncIterator[ArtifactMetadataStore]:
    """
    Returns:
        The `MetadataStore` subclass to use.

    """
    return await _load_dependency(
        "backends.video_metadata_store",
        check_type=ArtifactMetadataStore,
    )
