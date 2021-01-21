"""
Implements utilities for mocking Confuse `ConfigView`s.
"""


import unittest.mock as mock
from typing import Any

from confuse import ConfigView


class ConfigViewMock(mock.NonCallableMock):
    """
    Special mock for `ConfigView` instances that lets us set fake configuration.

    Examples:
        ```
        mock = ConfigViewMock()
        mock["foo"]["bar"].as_str.return_value = "bar"
        mock["pi"].as_number.return_value = 3.14

        print(mock["foo"]["bar"].as_str())
        print(mock["pi"].as_number())
        ```
    """

    def __init__(self, *args: Any, **kwargs: Any):
        """
        Args:
            *args: Will be forwarded to the superclass.
            **kwargs: Will be forwarded to the superclass.
        """
        # Save arguments so that we can forward them to sub-views.
        super().__init__(spec=ConfigView, instance=True, *args, **kwargs)
        self.__args = args
        self.__kwargs = kwargs

        # Stores fake configuration values that we have set.
        self.__config_values = {}

    def __getitem__(self, config_key: str) -> "ConfigViewMock":
        """
        Gets a mocked sub-view for a particular configuration key. The
        particular view will be unique for each key.

        Args:
            config_key: The configuration key.

        Returns:
            The corresponding view for this key.

        """
        sub_view = self.__config_values.get(config_key)
        if sub_view is None:
            # We have not accessed this key before. Create a new sub-view.
            sub_view = ConfigViewMock(*self.__args, **self.__kwargs)
            self.__config_values[config_key] = sub_view

        return sub_view
