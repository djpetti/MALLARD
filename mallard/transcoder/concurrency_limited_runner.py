"""
This class is a wrapper around `asyncio.create_subprocess_exec` that
limits the number of concurrent processes.
"""


import asyncio

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
        self.__semaphore = asyncio.Semaphore(max_processes)
        self.__running_processes = set()

    async def run(self, *args, **kwargs) -> asyncio.subprocess.Process:
        """
        Runs a new process.

        Args:
            *args: Forwarded to `create_subprocess_exec`
            **kwargs: Forwarded to `create_subprocess_exec`.

        Returns:
            The process it created.

        """

        # Task that waits for a process to finish.
        async def _wait_for_process(
            process_: asyncio.subprocess.Process,
        ) -> None:
            await process_.wait()
            # Release the semaphore.
            logger.debug("Process finished, releasing semaphore.")
            self.__semaphore.release()

        # Acquire the semaphore before starting.
        logger.debug("Acquiring semaphore to start subprocess...")
        await self.__semaphore.acquire()

        try:
            # Start the process.
            process = await asyncio.create_subprocess_exec(*args, **kwargs)
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
