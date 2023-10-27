#!/bin/bash

# Dumps a MariaDB database for backups.

# MariaDB credentials.
MARIADB_ROOT_PASSWORD=TnrHYavLF7WF38
MARIADB_DATABASE=mallard_meta

set -e

# How frequently to run (default is once a day).
PERIOD=86400

# Wait initially for database to start.
sleep 10

while true; do
  echo "Backing up metadata..."
  echo ${MARIADB_ROOT_PASSWORD} | \
    mariadb-dump --password --lock-tables --host metadata-store \
    mallard_meta > /backups/mallard_meta.sql
  echo "Done backing up."
  sleep $PERIOD
done
