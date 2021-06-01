####
# gateway_builder image is used for building the gateway service dependencies.
####
FROM python:3.9.2-slim AS gateway_builder

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
# service_base image is used as a common base for mallard services.
####
FROM python:3.9.2-slim AS service_base

# Run as a non-root user.
RUN useradd -ms /bin/bash gateway
USER gateway
WORKDIR /home/gateway/

# Copy dependencies.
COPY --from=gateway_builder /install/deps /usr/local
COPY mallard mallard

####
# gateway image is used for running the gateway server.
####
FROM service_base AS gateway

COPY init_db.sh /init_db.sh
COPY alembic.ini alembic.ini

# Copy config files.
COPY config/local/local_config.yaml .config/mallard/config.yaml

# Set the correct root path.
ENV SCRIPT_NAME="/api/v1/"

CMD gunicorn -w $(nproc) -b 0.0.0.0:8000 \
     -k mallard.gateway.configurable_worker.ConfigurableWorker \
     mallard.gateway.main:app

####
# edge_builder image is used for building the edge service dependencies.
####
# Base this off the gateway container, because we need to be able to run the
# gateway service when we generate the API.
FROM gateway AS edge_builder

USER root

RUN apt-get update
RUN apt-get install -y curl

WORKDIR /home/gateway/

# Install Node.
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.38.0/install.sh | bash
ENV NVM_DIR=/root/.nvm
RUN . ~/.nvm/nvm.sh && echo ${NVM_DIR} && nvm install 15.8.0

# Install NPM dependencies.
RUN cd mallard/edge/frontend && . ~/.nvm/nvm.sh && npm install

# Build the frontend.
RUN apt-get update
# Hacky fix for this issue: https://github.com/debuerreotype/docker-debian-artifacts/issues/24
RUN mkdir -p /usr/share/man/man1
RUN apt-get install -y default-jre
# Make sure the root user sees the proper config file.
ENV MALLARDDIR=/home/gateway/.config/mallard
COPY deploy.py deploy.py
RUN . ~/.nvm/nvm.sh && python deploy.py build

####
# edge image is used for running the edge service.
####
FROM service_base AS edge

# Copy frontend package.
COPY --from=edge_builder /home/gateway/mallard/edge/frontend/bundled \
    /home/gateway/mallard/edge/frontend/bundled

CMD gunicorn -w $(nproc) -b 0.0.0.0:8000 \
     -k uvicorn.workers.UvicornWorker \
     mallard.edge.main:app
