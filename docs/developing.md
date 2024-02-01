# Developer Guide

Setting up MALLARD for development is a little bit different than merely
running it.

1. Make sure you have installed Python 3.11
   (possibly via [pyenv](https://github.com/pyenv/pyenv)),
   [Poetry](https://python-poetry.org/docs/#installing-with-the-official-installer),
   and NPM.
1. In the MALLARD directory, run `poetry install --no-root` to install the
   Python dependencies.
1. Run `poetry shell` to activate the Python virtual environment.
1. The `deploy.py` script automates the process of building the frontend.
   Run `python deploy.py build` to do this now.
1. Follow the instructions in the [README](../README.md) for generating,
   building, and running a `docker-compose` file. Make sure you select
   "development" as the `mode` option.
1. Follow the instructions in the [README](../README.md) for initializing
   the database.

Congratulations! MALLARD should now be running on your local computer. It
should be treating your local filesystem as a Docker volume so that any
changes you make to the code should apply without having to rebuild the
container.

## Changing the Backend

If you changed the backend (any of the Python files), you will have to
restart the Docker compose configuration for the change to take effect:

```bash
docker compose -f <your compose file>.yml down
docker compose -f <your compose file>.yml up
```

That should be it!

One important point to note: If you change anything that affects the API in
any way, you will also have to regenerate the frontend API client to avoid
breaking the frontend. This is done automatically with the `deploy.py` script:

```bash
python deploy.py build
```

## Changing the Frontend

If all you changed is the frontend (any of the Typescript files), you do not
need to restart the compose configuration. All you need to do is rebuild the
frontend, and the changes should be applied:

```bash
python deploy.py build -b
```

Note the `-b` option in the `deploy.py` script. This skips certain build
steps (including regenerating the API client) that aren't necessary when you
only made changes to the frontend. Adding this option is not strictly needed,
but it speeds up the build process quite a bit.

Once you have rebuilt the frontend, make sure that you reload the page in
your browser *with caching disabled*. The method of doing this varies
between browsers.
