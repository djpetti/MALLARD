"""
Deployment helper script for GAE.
"""


import os
import subprocess
from argparse import ArgumentParser, Namespace
from contextlib import contextmanager
from functools import cache
from pathlib import Path
from typing import Iterator

from loguru import logger

_REPO_ROOT = Path(__file__).parent
"""
Path to the root directory of the repository.
"""
_EDGE_ROOT = _REPO_ROOT / "mallard" / "edge"
"""
Root directory of the edge package.
"""


@cache
def _find_tool(tool_name: str) -> Path:
    """
    Finds a particular command-line tool.

    Args:
        tool_name: The name of the tool.

    Returns:
        The path to the tool.

    """
    which_result = subprocess.run(
        ["/usr/bin/which", tool_name], check=True, capture_output=True
    )
    which_output = which_result.stdout.decode("utf8")
    if not which_output:
        raise OSError(f"Could not find '{tool_name}'. Is it installed?")

    tool_path = Path(which_output.rstrip("\n"))
    logger.debug("Using {} executable: {}", tool_name, tool_path)
    return tool_path


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
                _find_tool("poetry").as_posix(),
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


def _build_frontend() -> None:
    """
    Builds frontend code prior to deploying.

    """
    logger.info("Building frontend code...")

    with _working_dir(_EDGE_ROOT / "frontend"):
        npm_path = _find_tool("npm")

        # Lint, build and bundle.
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
    subparsers = parser.add_subparsers()

    deploy_parser = subparsers.add_parser("deploy", help="Deploy to GAE.")
    deploy_parser.add_argument(
        "service", help="The name of the service to deploy."
    )
    deploy_parser.set_defaults(func=_deploy)

    build_parser = subparsers.add_parser("build", help="Build the frontend.")
    build_parser.set_defaults(func=lambda _: _build_frontend())

    return parser


def main() -> None:
    parser = _make_parser()
    args = parser.parse_args()

    args.func(args)


if __name__ == "__main__":
    main()
