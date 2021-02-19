"""
Utilities for asynchronous code.
"""


import asyncio
from concurrent import futures
from functools import cache
from typing import AsyncIterable, Iterable, TypeVar

from loguru import logger

IterType = TypeVar("IterType")


@cache
def get_process_pool() -> futures.ProcessPoolExecutor:
    logger.debug("Creating process pool.")
    return futures.ProcessPoolExecutor()


async def make_async_iter(
    source: Iterable[IterType],
) -> AsyncIterable[IterType]:
    """
    Wraps a synchronous iterable, making it async. Items will be read from the
    wrapped iterable in a separate thread.

    Args:
        source: The iterable to wrap.

    Returns:
        An asynchronous version of the iterable.

    """
    queue = asyncio.Queue()
    main_loop = asyncio.get_running_loop()

    def iterate_in_thread() -> None:
        """
        Run in a separate thread to get each item.
        """
        for item in source:
            # Send it to the async side.
            put_future = asyncio.run_coroutine_threadsafe(
                queue.put(item), main_loop
            )
            futures.wait((put_future,))

    async def next_item() -> IterType:
        """
        Pulls items off the queue one-by-one.

        Returns:
            The next item off the queue.

        """
        item = await queue.get()
        queue.task_done()

        return item

    writer = asyncio.create_task(asyncio.to_thread(iterate_in_thread))
    reader = asyncio.create_task(next_item())
    joiner = asyncio.create_task(queue.join())

    # Run both tasks until exhausted.
    pending = {writer, reader}
    while True:
        done, pending = await asyncio.wait(
            pending, return_when=asyncio.FIRST_COMPLETED
        )

        # Propagate exceptions.
        for task in done:
            if task.exception() is not None:
                raise task.exception()

        if writer in done:
            # We finished writing. Now just wait for all the queued items to
            # be processed.
            pending.add(joiner)
        if joiner in done:
            # Everything on the queue has been processed.
            break

        if reader in done:
            # We finished reading the next item.
            yield reader.result()

            # Make sure to read the next one.
            reader = asyncio.create_task(next_item())
            pending.add(reader)

    for task in pending:
        task.cancel()
