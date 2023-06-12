"""
Deployment helper script for GAE.
"""


import multiprocessing as mp
import os
import subprocess
from argparse import ArgumentParser, Namespace
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

import uvicorn
from loguru import logger

from mallard.cli_utils import find_exe

_REPO_ROOT = Path(__file__).parent
"""
Path to the root directory of the repository.
"""
_EDGE_ROOT = _REPO_ROOT / "mallard" / "edge"
"""
Root directory of the edge package.
"""
_GATEWAY_PORT = 8000
"""
Port to use for the gateway server.
"""


@contextmanager
def _requirements_txt() -> Iterator[None]:
    """
    Creates a temporary requirements.txt file in the repository root, cleaning
    it up upon exiting the context manager.

    """
    output_path = _REPO_ROOT / "requirements.txt"
    logger.debug("Creating a requirements.txt file in {}.", output_path)

    try:
        subprocess.run(
            [
                find_exe("poetry").as_posix(),
                "export",
                "-f",
                "requirements.txt",
                "--without-hashes",
                "-o",
                output_path.as_posix(),
            ],
            check=True,
        )

        yield

    finally:
        logger.debug("Removing requirements.txt file.")
        output_path.unlink(missing_ok=True)


@contextmanager
def _working_dir(new_dir: Path) -> Iterator[None]:
    """
    Changes to a new working directory for the duration of the context manager.

    Args:
        new_dir: The new directory to change to.

    """
    current_dir = Path.cwd()
    logger.debug("Entering directory {}", new_dir)
    os.chdir(new_dir.as_posix())

    try:
        yield
    finally:
        # Return the to the original working directory.
        logger.debug("Entering directory {}", current_dir)
        os.chdir(current_dir.as_posix())


def _deploy_service(service_name: str) -> None:
    """
    Deploys a service to GAE.

    Args:
        service_name: The name of the service to deploy.

    """
    # Determine the name of the app.yaml file.
    app_yaml_name = f"{service_name}.yaml"
    app_yaml_path = _REPO_ROOT / app_yaml_name
    if not app_yaml_path.exists():
        raise ValueError(
            f"Could not find app.yaml file '{app_yaml_path}' for "
            f"service {service_name}."
        )
    logger.info("Deploying service with app.yaml file {}.", app_yaml_path)

    with _requirements_txt():
        subprocess.run(
            ["/usr/bin/gcloud", "app", "deploy", app_yaml_path.as_posix()],
            check=True,
        )


@contextmanager
def _gateway_server() -> Iterator[None]:
    """
    Starts the gateway server in a separate thread. Note that we don't really
    have a good way to stop it, so it will just run until the script exits.

    """
    logger.debug("Starting gateway server.")
    server_process = mp.Process(
        target=uvicorn.run,
        args=("mallard.gateway.main:app",),
        kwargs=dict(host="0.0.0.0", port=_GATEWAY_PORT),
    )
    server_process.start()

    try:
        yield
    finally:
        logger.debug("Stopping gateway server.")
        server_process.terminate()


def _generate_api_client() -> None:
    """
    Generates a TypeScript client for the gateway API.

    """
    with _gateway_server(), _working_dir(_EDGE_ROOT / "frontend"):
        npm_path = find_exe("npm")

        # Generate the API client.
        subprocess.run([npm_path.as_posix(), "run", "api"], check=True)
        subprocess.run([npm_path.as_posix(), "ci"], check=True)


def _build_frontend(cli_args: Namespace) -> None:
    """
    Builds frontend code prior to deploying.

    Args:
        cli_args: The parsed CLI arguments.

    """
    logger.info("Building frontend code...")

    # Generate the API client.
    if not cli_args.build_only:
        _generate_api_client()

    with _working_dir(_EDGE_ROOT / "frontend"):
        npm_path = find_exe("npm")

        # Format, lint, build and bundle.
        if not cli_args.build_only:
            subprocess.run([npm_path.as_posix(), "run", "format"], check=True)
            subprocess.run([npm_path.as_posix(), "run", "lint"], check=True)
        subprocess.run([npm_path.as_posix(), "run", "build"], check=True)
        subprocess.run([npm_path.as_posix(), "run", "bundle"], check=True)


def _deploy(cli_args: Namespace) -> None:
    """
    Target for the "deploy" command.

    Args:
        cli_args: The parsed CLI arguments.

    """
    _build_frontend()
    _deploy_service(cli_args.service)


def _make_parser() -> ArgumentParser:
    """
    Creates a parser to use for command-line arguments.

    Returns:
        The parser that it created.

    """
    parser = ArgumentParser(description="Build and deploy to GAE.")
    subparsers = parser.add_subparsers(
        title="action", dest="action", required=True
    )

    deploy_parser = subparsers.add_parser("deploy", help="Deploy to GAE.")
    deploy_parser.add_argument(
        "service", help="The name of the service to deploy."
    )
    deploy_parser.set_defaults(func=_deploy)

    build_parser = subparsers.add_parser("build", help="Build the frontend.")
    build_parser.add_argument(
        "-b",
        "--build-only",
        action="store_true",
        help="Only builds the frontend, without linting or re-generating the"
        " API client.",
    )
    build_parser.set_defaults(func=_build_frontend)

    return parser


def main() -> None:
    parser = _make_parser()
    args = parser.parse_args()

    args.func(args)


if __name__ == "__main__":
    main()
