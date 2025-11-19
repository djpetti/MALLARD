"""
This class is a wrapper around `asyncio.create_subprocess_exec` that
limits the number of concurrent processes.
"""


import asyncio
import uuid

from loguru import logger


class ConcurrencyLimitedRunner:
    """
    This class is a wrapper around `asyncio.create_subprocess_exec` that
    limits the number of concurrent processes.
    """

    def __init__(self, max_processes: int = 1):
        """
        Args:
            max_processes: The maximum number of processes to run at once.
        """
        self.__max_processes = max_processes

        self.__semaphore = asyncio.Semaphore(max_processes)
        self.__running_processes = set()

        # Set of tokens for processing slots that are currently reserved.
        self.__reserved_tokens = set()

    async def run(
        self, *args, reservation_token: str | None = None, **kwargs
    ) -> asyncio.subprocess.Process:
        """
        Runs a new process.

        Args:
            *args: Forwarded to `create_subprocess_exec`
            reservation_token: The token for a reserved slot to use,
                if we want to use one.
            **kwargs: Forwarded to `create_subprocess_exec`.

        Returns:
            The process it created.

        """

        # Task that waits for a process to finish.
        async def _wait_for_process(
            process_: asyncio.subprocess.Process,
        ) -> None:
            pid = process_.pid
            await process_.wait()
            # Release the semaphore.
            logger.debug("Process {} finished, releasing semaphore.", pid)
            self.__semaphore.release()

        if (
            reservation_token is not None
            and reservation_token in self.__reserved_tokens
        ):
            # We previously acquired the semaphor, so we can skip it.
            logger.debug("Using reservation: {}", reservation_token)
            self.__reserved_tokens.remove(reservation_token)
        else:
            # Acquire the semaphore before starting.
            logger.debug(
                "Acquiring semaphore with state: {}", self.__semaphore
            )
            await self.__semaphore.acquire()
            logger.debug("Successfully acquired semaphore.")

        try:
            # Start the process.
            process = await asyncio.create_subprocess_exec(*args, **kwargs)
            logger.debug("Process {} started.", process.pid)
            # Wait for it to finish and then release the semaphore.
            asyncio.create_task(
                _wait_for_process(process), name="wait_for_process"
            )
        except Exception as err:
            # Release the lock if something fails prematurely.
            logger.debug("Process failed to start, releasing semaphore.")
            self.__semaphore.release()
            raise err

        return process

    async def reserve(self) -> str:
        """
        Reserves a processing slot, but does not actually run anything yet.
        Might block while waiting for a slot to become free.

        Returns:
            A token that can be passed to `run()` in order to use the
            reserved slot.

        """
        logger.debug(
            "Reserving processing slot with semaphore state: {}",
            self.__semaphore,
        )
        await self.__semaphore.acquire()

        token = uuid.uuid4().hex
        logger.debug("Processing slot successfully reserved for {}.", token)
        self.__reserved_tokens.add(token)
        return token
