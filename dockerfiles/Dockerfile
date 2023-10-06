####
# proxy image is used for the reverse proxy.
####
FROM nginx AS proxy

# Install dependencies.
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Configure SSL.
RUN openssl req -x509 -nodes -days 365 -subj "/C=US/ST=FL/O=BSAIL/CN=uflbsail.net" \
    -addext "subjectAltName=DNS:uflbsail.net" -newkey rsa:2048  \
    -keyout /etc/ssl/private/nginx-selfsigned.key  \
    -out /etc/ssl/certs/nginx-selfsigned.crt

####
# gateway_builder image is used for building the gateway service dependencies.
####
FROM python:3.11.1-slim AS gateway_builder

# Install poetry.
RUN apt-get update
RUN apt-get install -y curl
RUN curl -sSL https://install.python-poetry.org | python3 -

# Export dependencies.
WORKDIR /install
COPY poetry.lock poetry.lock
COPY pyproject.toml pyproject.toml
RUN $HOME/.local/bin/poetry export -n --without-hashes -o requirements.txt

# Install dependencies.
RUN apt-get install -y build-essential git
RUN mkdir deps && python -m pip install --prefix=deps -r requirements.txt

####
# service_base image is used as a common base for mallard services.
####
FROM python:3.11.1-slim AS service_base

# Run as a non-root user.
RUN useradd -ms /bin/bash mallard
USER mallard
WORKDIR /home/mallard/

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
     -k mallard.configurable_worker.ConfigurableWorker \
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

WORKDIR /home/mallard/

# Install Node.
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.3/install.sh | bash
ENV NVM_DIR=/root/.nvm
RUN . ~/.nvm/nvm.sh && echo ${NVM_DIR} && nvm install 19.5.0

# Install NPM dependencies.
RUN cd mallard/edge/frontend && . ~/.nvm/nvm.sh && npm install

# Build the frontend.
RUN apt-get update
# Hacky fix for this issue: https://github.com/debuerreotype/docker-debian-artifacts/issues/24
RUN mkdir -p /usr/share/man/man1
RUN apt-get install -y default-jre
# Make sure the root user sees the proper config file.
ENV MALLARDDIR=/home/mallard/.config/mallard
COPY deploy.py deploy.py
RUN . ~/.nvm/nvm.sh && python deploy.py build

####
# edge image is used for running the edge service.
####
FROM service_base AS edge

# Copy frontend package.
COPY --from=edge_builder /home/mallard/mallard/edge/frontend/bundled \
    /home/mallard/mallard/edge/frontend/bundled
COPY --from=edge_builder /home/mallard/.config /home/mallard/.config

CMD gunicorn -w $(nproc) -b 0.0.0.0:8000 \
     -k mallard.configurable_worker.ConfigurableWorker \
     mallard.edge.main:app

#####
# transcoder image is used for running the transcoder service.
#####
FROM service_base as transcoder

# Install runtime dependencies.
USER root
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*
USER mallard

# Copy configuration.
COPY --from=edge_builder /home/mallard/.config /home/mallard/.config

# Deliberately limiting number of workers here because FFMpeg is multi-threaded.
CMD gunicorn -w 1 -b 0.0.0.0:8000 \
     -k mallard.configurable_worker.ConfigurableWorker \
     mallard.transcoder.main:app
