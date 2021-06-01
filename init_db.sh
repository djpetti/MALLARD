#!/bin/bash

# One-time database initialization.

# Activate the virtualenv.
alembic upgrade head
