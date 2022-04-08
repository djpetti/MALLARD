"""
A cache implementation that expires items when they get too old.
"""


from datetime import timedelta
from typing import Callable, Any
import functools
import time
from loguru import logger


DecoratedType = Callable[[Any, ...], Any]
"""
Type of function that we can decorate.
"""
DecoratorType = Callable[[DecoratedType], DecoratedType]
"""
The type of the internal decorator function.
"""


def time_expiring_cache(expiration_time: timedelta) -> DecoratorType:
    """
    A cache implementation that expires items when they get too old. Meant
    to be used as a decorator on a function in order to cache the results of
    the function. Similar to `functools.cache`, the arguments must be
    hashable.

    Args:
        expiration_time: How long an item can remain cached before it expires.

    Returns:
        The wrapper function.

    """
    # Convert to seconds for easy comparison.
    expiration_time = expiration_time.total_seconds()

    def cache_decorator(func: DecoratedType) -> DecoratedType:
        """
        The decorator function.

        Args:
            func: The function to decorate.

        Returns:
            The wrapped function.

        """
        cache = {}

        @functools.wraps(func)
        def wrapper_cache(*args: Any, **kwargs: Any) -> Any:
            # We need to make sure that the kwargs are always interpreted in
            # the same order.
            ordered_keys = sorted(kwargs.keys())
            ordered_values = [kwargs[k] for k in ordered_keys]
            arg_key = tuple(args) + tuple(ordered_values)
            function_result = cache.get(arg_key)

            result_expired = False
            if function_result is not None:
                # Check if the result has expired.
                result_value, result_time = function_result
                result_expired = (time.time() - result_time) >= expiration_time
                if result_expired:
                    logger.debug("Reloading expired function result.")

            if function_result is None or result_expired:
                # It is not in the cache, or it expired.
                result_value = func(*args, **kwargs)

            cache[arg_key] = (result_value, time.time())

            return result_value

        return wrapper_cache

    return cache_decorator
