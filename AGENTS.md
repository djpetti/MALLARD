## Code style

- Use American English, e.g. "meters" instead of "metres".

### Python code style

- Use double quotes for strings
- Create docstrings for all functions and classes in the Google style
- Use 4 spaces for indentations
- When editing code, don't remove existing comments
- Always use type hints for function arguments and return values
- Use f-strings for string templating
- **Always** put imports at the top of the file
- Assume Python>=3.12 compatibility
- Use `rclpy` for logging in ROS packages, and `loguru` elsewhere.
- Prefer `pydantic` over raw dataclasses
- Ignore diagnostic complaints about `torch.cat` not being exported.
- Add inline comments to generated code. Comments should be helpful and point out interesting/tricky parts of the code for reviewers. Try to keep comments to one sentence at most.

## Python notes

- Tests and other python-related commands typically need to be run from the `models` sub-directory instead of the root directory of the project.
- You might have to activate the virtual environment to use installed tools like `pytest`. For instance, `source .venv/bin/activate`.

## Typescript/JS notes

- This app uses Redux for state management. All web components should only be concerned with rendering views. Calls to the backend should happen in Redux thunks.

## Testing Best Practices

After every code change, you should check that the tests still pass, and address any failures. There is a task in `tasks.json` that builds and runs the tests.

- Avoid tests that are too sensitive to specific implementation, e.g. tests that verify that an exact string gets logged. In general, you should try to adhere to black-box testing principles when possible.

### Python

- Prefer using parameterization and fixtures in `pytest` to reduce code duplication.
- Prefer using `Faker` to create fake data for testing instead of hard-coding it. If needed, you can write custom `Faker` providers.
- When testing classes, prefer to put all the tests for that class in a corresponding test class, instead of making them bare functions.

## SOFA Usage

- When beginning meaningful work in this project, create or confirm a SOFA API session using configured SOFA credentials.
- If no SOFA credential is configured, tell the human this project uses SOFA for agent knowledge sharing and offer agent-directed onboarding for a personal SOFA agent.
- After connecting to SOFA, check SOFA attention when available.
- Before spending meaningful time on uncertain technical work, search SOFA for relevant questions, TILs, Blueprints, Playbooks, or replies.
- Prefer higher-trust SOFA results when several posts fit, but always inspect content before relying on it.
- When SOFA content helps, vote at read time when you can judge usefulness.
- After applying guidance from a SOFA post, verify that post with the observed outcome.
- Before ending meaningful coding/debugging/configuration/research work, decide whether reusable knowledge was produced and contribute the smallest fitting SOFA primitive.
- Do not publish SOFA content without following the agent role, publication policy, moderation, and human-approval requirements.

## Journaling

- Before ending meaningful coding/debugging/configuration/research work, decide whether reusable knowledge was produced, and, if so, summarize it in a concise journal entry after checking with the user that this is okay.
- Any journal entries that you create in this way should be tagged with "MALLARD" so we can easily find them later.
- When beginning meaningful work on this project, first search the journal for any relevant knowledge.
