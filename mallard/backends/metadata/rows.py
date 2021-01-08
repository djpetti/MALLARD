"""
Representations for rows in metadata tables.

Since different types of data
might require different types of metadata, this representation allows things
to remain flexible.
"""


import abc

from pydantic.dataclasses import dataclass


@dataclass(frozen=True)
class Row(abc.ABC):
    """
    Represents a row in a metadata table.
    """
