"""
Deployment helper script for GAE.
"""


import subprocess
from argparse import ArgumentParser
from contextlib import contextmanager
from functools import cache
from pathlib import Path
from typing import Iterator

from loguru import logger

_REPO_ROOT = Path(__file__).parent
"""
Path to the root directory of the repository.
"""


@cache
def _find_poetry() -> Path:
    """
    Finds the path to a `poetry` installation.

    Returns:
        The path to `poetry` that it found.

    """
    home_dir = Path.home()
    # This is the standard location for the executable.
    poetry_exe = home_dir / ".poetry" / "bin" / "poetry"
    if not poetry_exe.exists():
        raise OSError(
            f"Expected Poetry installation in {poetry_exe}, "
            f"but could not find it."
        )

    logger.debug("Using poetry executable: {}", poetry_exe)
    return poetry_exe


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
                _find_poetry().as_posix(),
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


def _make_parser() -> ArgumentParser:
    """
    Creates a parser to use for command-line arguments.

    Returns:
        The parser that it created.

    """
    parser = ArgumentParser(description="Deploy to GAE.")
    parser.add_argument("service", help="The name of the service to deploy.")

    return parser


def main() -> None:
    parser = _make_parser()
    args = parser.parse_args()

    _deploy_service(args.service)


if __name__ == "__main__":
    main()
