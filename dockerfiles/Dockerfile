####
# builder image is used for building our dependencies.
####
FROM python:3.9.2-slim AS builder

# Install poetry.
RUN apt-get update
RUN apt-get install -y curl
RUN curl -sSL https://raw.githubusercontent.com/python-poetry/poetry/master/get-poetry.py | python -

# Export dependencies.
WORKDIR /install
COPY poetry.lock poetry.lock
COPY pyproject.toml pyproject.toml
RUN . $HOME/.poetry/env && poetry export -n -o requirements.txt

# Install dependencies.
RUN apt-get install -y build-essential
RUN mkdir deps && python -m pip install --prefix=deps -r requirements.txt

####
# gateway image is used for running the gateway server.
####
FROM python:3.9.2-slim AS gateway

# Copy dependencies.
COPY --from=builder /install/deps /usr/local
COPY mallard /mallard

# Set the correct root path.
ENV SCRIPT_NAME="/api/v1/"

CMD ["gunicorn", "-w 1", "-b 0.0.0.0:8000", \
     "-k mallard.gateway.configurable_worker.ConfigurableWorker", \
     "mallard.gateway.main:app"]
