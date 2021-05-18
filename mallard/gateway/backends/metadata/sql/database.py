"""
Initializes global database attributes.
"""


from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

from ....config import config

_METADATA_CONFIG = config["backends"]["metadata_store"]["config"]
