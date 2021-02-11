"""
Helper utilities for dealing with metadata in iRODS.
"""


import abc
from calendar import timegm
from datetime import date, datetime, time
from typing import Any, Generic, TypeVar

_SerializedType = TypeVar("_SerializedType")


class _Serializer(Generic[_SerializedType], abc.ABC):
    """
    Handles serializing Python objects to strings so that they can be
    stored as iRODS metadata values. They should be serialized in such a
    way that relational operators do what we would expect given the raw
    objects.
    """

    @abc.abstractmethod
    def to_irods(self, value: _SerializedType) -> str:
        """
        Converts a value to a string that can be used in iRODS.

        Args:
            value: The value to convert.

        Returns:
            The value as a string.

        """

    @abc.abstractmethod
    def to_python(self, value: str) -> _SerializedType:
        """
        Converts a value from an iRODS string to the original Python object.

        Args:
            value: The string value to convert.

        Returns:
            The value as a Python object.

        """


class _StrSerializer(_Serializer[str]):
    """
    Serializer for strings.
    """

    def to_irods(self, value: _SerializedType) -> str:
        return value

    def to_python(self, value: str) -> _SerializedType:
        return value


class _NoneTypeSerializer(_Serializer[type(None)]):
    """
    Serializer for `None` values.
    """

    def to_irods(self, value: _SerializedType) -> str:
        # We don't need any more information beyond the prefix.
        return ""

    def to_python(self, value: str) -> _SerializedType:
        return None


class _IntSerializer(_Serializer[int]):
    """
    Serializer for integers.
    """

    def to_irods(self, value: _SerializedType) -> str:
        # Constrain to a standard number of digits so we can compare
        # lexicographically.
        as_string = f"{value:020}"
        assert (
            len(as_string) == 20
        ), f"Value {value} is too large for metadata."

        return as_string

    def to_python(self, value: str) -> _SerializedType:
        return int(value)


class _FloatSerializer(_Serializer[float]):
    """
    Serializer for floats.
    """

    def to_irods(self, value: _SerializedType) -> str:
        # Constrain to a standard number of digits so we can compare
        # lexicographically.
        as_string = f"{value:020.6f}"
        assert (
            len(as_string) == 20
        ), f"Value {value} is too large for metadata."

        return as_string

    def to_python(self, value: str) -> _SerializedType:
        return float(value)


class _DateTimeSerializer(_Serializer[datetime]):
    """
    Serializer for `datetime`s.
    """

    def __init__(self):
        # Underlying integer serializer to use.
        self.__int_serializer = _IntSerializer()

    def to_irods(self, value: _SerializedType) -> str:
        # Convert to seconds since the epoch.
        unix_time = timegm(value.utctimetuple())

        # Serialize the underlying int.
        return self.__int_serializer.to_irods(unix_time)

    def to_python(self, value: str) -> _SerializedType:
        # Parse the underlying integer.
        unix_time = self.__int_serializer.to_python(value)
        # Convert to a datetime.
        return datetime.utcfromtimestamp(unix_time)


class _DateSerializer(_Serializer[date]):
    """
    Serializer for `dates`.
    """

    def __init__(self):
        # Underlying datetime serializer to use.
        self.__datetime_serializer = _DateTimeSerializer()

    def to_irods(self, value: _SerializedType) -> str:
        # Convert to a datetime.
        as_datetime = datetime.combine(value, time())
        return self.__datetime_serializer.to_irods(as_datetime)

    def to_python(self, value: str) -> _SerializedType:
        # Parse the underlying datetime.
        got_datetime = self.__datetime_serializer.to_python(value)
        return got_datetime.date()


_TYPES_TO_PREFIX = {
    str: "STR",
    int: "INT",
    float: "FLT",
    datetime: "DTM",
    date: "DAT",
    type(None): "NUL",
}
"""
Since everything is stored in iRODS as a string, we use these 3-character
prefixes to identify the Python type.
"""

_PREFIX_TO_TYPES = {v: k for k, v in _TYPES_TO_PREFIX.items()}
"""
Inverse of `_TYPES_TO_PREFIX` mapping.
"""

_TYPES_TO_SERIALIZERS = {
    str: _StrSerializer(),
    int: _IntSerializer(),
    float: _FloatSerializer(),
    datetime: _DateTimeSerializer(),
    date: _DateSerializer(),
    type(None): _NoneTypeSerializer(),
}
"""
Maps types to corresponding `_Serializer` subclasses.
"""


def to_irods_string(value: Any) -> str:
    """
    Converts a raw Python object to a string representation that can be
    used as iRODS metadata.

    Args:
        value: The object to convert.

    Returns:
        The string representation.

    """
    prefix = _TYPES_TO_PREFIX[type(value)]
    serializer = _TYPES_TO_SERIALIZERS[type(value)]

    return f"{prefix}{serializer.to_irods(value)}"


def from_irods_string(value: str) -> Any:
    """
    Converts an iRODS metadata string back to a Python object.

    Args:
        value: The iRODS object to convert.

    Returns:
        The converted object.

    """
    # Split the prefix.
    prefix = value[:3]
    serialized = value[3:]

    output_type = _PREFIX_TO_TYPES[prefix]
    serializer = _TYPES_TO_SERIALIZERS[output_type]

    return serializer.to_python(serialized)
