"""
Tests for the `concurrency_limited_runner` module.
"""
import asyncio
from unittest import mock

import pytest
from faker import Faker
from pydantic.dataclasses import dataclass
from pytest_mock import MockFixture

from mallard.transcoder import concurrency_limited_runner
from mallard.type_helpers import ArbitraryTypesConfig


class TestConcurrencyLimitedRunner:
    """
    Tests for the `ConcurrencyLimitedRunner` class.
    """

    @dataclass(frozen=True, config=ArbitraryTypesConfig)
    class ConfigForTests:
        """
        Encapsulates standard configuration for most tests.

        Attributes:
            runner: The `ConcurrencyLimitedRunner` under test.
            mock_create_subprocess_exec: The mocked `create_subprocess_exec`
                function.

        """

        runner: concurrency_limited_runner.ConcurrencyLimitedRunner
        mock_create_subprocess_exec: mock.Mock

    class FakeProcess:
        """
        A fake process class that's instrumented for testing.
        """

        def __init__(self):
            # Internal event object to manage waiting.
            self.__event = asyncio.Event()
            # Flag that keeps track of whether the process is finished.
            self.__is_running = True

        async def wait(self) -> int:
            """
            Waits for the process to complete. This will not return until
            `finish()` is called.

            Returns:
                Always returns 0.

            """
            await self.__event.wait()
            return 0

        def finish(self) -> None:
            """
            An outside signal that indicates that the process should exit.
            """
            self.__is_running = False
            self.__event.set()

        @property
        def running(self) -> bool:
            """
            Returns whether the process is still running.
            """
            return self.__is_running

    @classmethod
    @pytest.fixture
    def config(cls, mocker: MockFixture) -> ConfigForTests:
        """
        Returns a standard configuration for most tests.

        Args:
            mocker: The mocker fixture.

        Returns:
            The standard configuration for most tests.
        """

        mock_create_subprocess_exec = mocker.patch(
            f"{concurrency_limited_runner.__name__}.asyncio"
            f".create_subprocess_exec"
        )

        return cls.ConfigForTests(
            runner=concurrency_limited_runner.ConcurrencyLimitedRunner(
                max_processes=1
            ),
            mock_create_subprocess_exec=mock_create_subprocess_exec,
        )

    @pytest.mark.asyncio
    async def test_non_concurrent(
        self, config: ConfigForTests, faker: Faker
    ) -> None:
        """
        Tests that it won't run multiple processes at the same time.

        Args:
            config: The configuration to use for testing.
            faker: The fixture to use for generating fake data.

        """
        # Arrange.
        # Create some fake processes.
        process1 = self.FakeProcess()
        process2 = self.FakeProcess()
        config.mock_create_subprocess_exec.side_effect = [process1, process2]

        # Arguments to pass to `create_subprocess_exec`.
        arg1 = faker.word()
        arg2 = faker.word()

        # Act.
        # Run the processes.
        got_process1 = await config.runner.run(arg1)
        process2_task = asyncio.create_task(
            config.runner.run(arg2), name="process2"
        )

        # Assert.
        # It should have started the first process okay, but not the second.
        config.mock_create_subprocess_exec.assert_called_once_with(arg1)
        assert got_process1 == process1
        assert process1.running

        # Make it look like the first process finished.
        process1.finish()

        # Now it should start the second process.
        await process2_task
        got_process2 = process2_task.result()
        assert got_process2 == process2
        assert config.mock_create_subprocess_exec.call_count == 2
        config.mock_create_subprocess_exec.assert_any_call(arg2)
        assert process2.running

        # Make it look like the second process finished.
        process2.finish()

        # Both processes should be completed.
        assert not process1.running
        assert not process2.running

    @pytest.mark.asyncio
    async def test_fails_to_start(
        self, config: ConfigForTests, faker: Faker
    ) -> None:
        """
        Tests that it properly cleans up after a process that fails to start.

        Args:
            config: The configuration to use for testing.
            faker: The fixture to use for generating fake data.

        """
        # Arrange.
        # Make it look like process creation fails.
        config.mock_create_subprocess_exec.side_effect = RuntimeError

        # Arguments to pass to `create_subprocess_exec`.
        arg1 = faker.word()
        arg2 = faker.word()

        # Act and assert.
        with pytest.raises(RuntimeError):
            await config.runner.run(arg1)
        config.mock_create_subprocess_exec.assert_called_once_with(arg1)

        # Arrange.
        # The semaphore should have been released, so a new process should
        # start immediately.
        process = self.FakeProcess()
        config.mock_create_subprocess_exec.side_effect = None
        config.mock_create_subprocess_exec.return_value = process

        # Act.
        got_process = await config.runner.run(arg2)

        # Assert.
        assert got_process == process
        assert config.mock_create_subprocess_exec.call_count == 2
        config.mock_create_subprocess_exec.assert_any_call(arg2)
        assert process.running

        # Finish the process.
        process.finish()

        # It should have completed.
        assert not process.running
