# Deploying Locally

MALLARD can be deployed locally using Docker. The provided configuration
contains everything you need to run a local instance of MALLARD, including
a MariaDB database for metadata, and a MinIO object store for image data.

Prerequisites:
- Docker >= 19.03.0
- `docker-compose`

First, you will need to build the docker images:
```bash
docker-compose build
```

After that, you need to start the MALLARD services:
```bash
docker-compose up
```

## Initializing the Database

The first time you start MALLARD with `docker-compose up`, it creates a blank
database. To actually use MALLARD, this database needs to be initialized with
the proper tables. A script for doing this is conveniently included.

First, you will need to figure out the name of the `gateway` service container,
using `docker ps`. Most likely, it will be `mallard_gateway_1`. Then, to initialize
the database, run:
```bash
docker exec mallard_gateway_1 /init_db.sh
```

This only has to be done once, unless you delete the MALLARD Docker volumes. On
subsequent restarts, you should be able to use MALLARD normally without this step.

## Accessing the Application

The MALLARD application should be accessible on your local machine at
http://localhost:8081. The MALLARD API should be accessible at
http://localhost:8081/api/v1. To access a convenient interface that allows you
to test the API manually, visit http://localhost:8081/api/v1/docs.
