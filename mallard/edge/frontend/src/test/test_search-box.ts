import {
  clearAutocomplete,
  thunkDoAutocomplete,
  thunkTextSearch,
} from "../thumbnail-grid-slice";
import { ConnectedSearchBox } from "../search-box";
import each from "jest-each";
import { fakeState, getShadowRoot } from "./element-test-utils";
import { RequestState } from "../types";

jest.mock("../thumbnail-grid-slice", () => {
  return {
    clearAutocomplete: jest.fn(),
    thunkDoAutocomplete: jest.fn(),
    thunkTextSearch: jest.fn(),
  };
});
const mockClearAutocomplete = clearAutocomplete as jest.MockedFn<
  typeof clearAutocomplete
>;
const mockThunkDoAutocomplete = thunkDoAutocomplete as jest.MockedFn<
  typeof thunkDoAutocomplete
>;
const mockThunkTextSearch = thunkTextSearch as jest.MockedFn<
  typeof thunkTextSearch
>;

// I know this sounds insane, but when I import this as an ES6 module, faker.seed() comes up
// undefined. I can only assume this is a quirk in Babel.
const faker = require("faker");

jest.mock("@captaincodeman/redux-connect-element", () => ({
  // Turn connect() into a pass-through.
  connect: jest.fn((_, elementClass) => elementClass),
}));
jest.mock("../store", () => ({
  // Mock this to avoid an annoying spurious console error from Redux.
  configureStore: jest.fn(),
}));

describe("search-box", () => {
  /** Internal search-box to use for testing. */
  let searchBoxElement: ConnectedSearchBox;

  beforeAll(() => {
    // Manually register the custom element.
    customElements.define(ConnectedSearchBox.tagName, ConnectedSearchBox);
  });

  beforeEach(() => {
    // Set a faker seed.
    faker.seed(1337);

    // Reset mocks.
    jest.clearAllMocks();

    // Add the element.
    searchBoxElement = window.document.createElement(
      ConnectedSearchBox.tagName
    ) as ConnectedSearchBox;
    document.body.appendChild(searchBoxElement);
  });

  afterEach(() => {
    document.body.getElementsByTagName(ConnectedSearchBox.tagName)[0].remove();
  });

  each([
    ["has nothing", false, false],
    ["has suggestions", true, false],
    ["is loading", false, true],
    ["has suggestions and is loading", true, true],
  ]).it(
    "renders correctly when it %s",
    async (_, hasSuggestions: boolean, isLoading: boolean) => {
      // Arrange.
      // Add autocomplete suggestions.
      const suggestions = hasSuggestions
        ? [faker.lorem.words(), faker.lorem.words()]
        : [];
      searchBoxElement.autocompleteSuggestions = suggestions;

      // Show the loading indicator if needed.
      searchBoxElement.showProgress = isLoading;

      // Act.
      await searchBoxElement.updateComplete;

      // Assert.
      const root = getShadowRoot(ConnectedSearchBox.tagName);

      // It should have rendered the text field.
      const textField = root.querySelector("#search") as HTMLInputElement;
      expect(textField).not.toBeNull();

      if (suggestions.length > 0) {
        // It should be showing autocomplete suggestions.
        const suggestionElement = root.querySelector("mwc-list") as HTMLElement;
        expect(suggestionElement).not.toBeNull();

        // It should be showing the correct ones.
        expect(suggestionElement.children).toHaveLength(suggestions.length);
        for (let i = 0; i < suggestions.length; ++i) {
          const listItem = suggestionElement.children[i];
          expect(listItem.textContent).toContain(suggestions[i]);
        }
      } else {
        // It should not be showing the autocomplete dropdown.
        expect(root.querySelector("mwc-list")).toBeNull();
      }

      if (isLoading) {
        // It should be showing the loading indicator.
        expect(root.querySelector("mwc-circular-progress")).not.toBeNull();
      } else {
        // It should not be showing the loading indicator.
        expect(root.querySelector("mwc-circular-progress")).toBeNull();
      }
    }
  );

  it("fires an event when the user types something", async () => {
    // Arrange.
    // Listen for the event.
    const searchStringChangedEventHandler = jest.fn();
    searchBoxElement.addEventListener(
      ConnectedSearchBox.SEARCH_STRING_CHANGED_EVENT_NAME,
      searchStringChangedEventHandler
    );

    // Add some text to the search box.
    const root = getShadowRoot(ConnectedSearchBox.tagName);
    const textField = root.querySelector("#search") as HTMLInputElement;
    textField.value = faker.lorem.words();

    // Act.
    // Make it look like the user typed something.
    textField.dispatchEvent(new InputEvent("input", {}));
    await searchBoxElement.updateComplete;

    // Assert.
    // It should have received the event.
    expect(searchStringChangedEventHandler).toBeCalledTimes(1);
    // It should have gotten the current search string.
    const event = searchStringChangedEventHandler.mock.calls[0][0];
    expect(event.detail).toEqual(textField.value);

    // It should also show the clear button.
    expect(root.querySelector("#clear_button")).not.toBeNull();
  });

  it("fires an event when the user hits enter", async () => {
    // Arrange.
    // Listen for the events.
    const searchBeginHandler = jest.fn();
    searchBoxElement.addEventListener(
      ConnectedSearchBox.SEARCH_STARTED_EVENT_NAME,
      searchBeginHandler
    );

    const clearHandler = jest.fn();
    searchBoxElement.addEventListener(
      ConnectedSearchBox.CLEARED_AUTOCOMPLETE_EVENT_NAME,
      clearHandler
    );

    // Add some text to the search box.
    const root = getShadowRoot(ConnectedSearchBox.tagName);
    const textField = root.querySelector("#search") as HTMLInputElement;
    textField.value = faker.lorem.words();

    // Act.
    // Make it look like the user hit enter.
    textField.dispatchEvent(new KeyboardEvent("keypress", { key: "Enter" }));
    await searchBoxElement.updateComplete;

    // Assert.
    // It should have received the events.
    expect(searchBeginHandler).toBeCalledTimes(1);
    expect(clearHandler).toBeCalledTimes(1);
    // It should have gotten the current search string.
    const event = searchBeginHandler.mock.calls[0][0];
    expect(event.detail).toEqual(textField.value);

    // It should not be showing the autocomplete dropdown.
    expect(root.querySelector("mwc-list")).toBeNull();
  });

  it("does not start a search if the user presses other keys", () => {
    // Arrange.
    // Listen for the events.
    const searchBeginHandler = jest.fn();
    searchBoxElement.addEventListener(
      ConnectedSearchBox.SEARCH_STARTED_EVENT_NAME,
      searchBeginHandler
    );

    const clearHandler = jest.fn();
    searchBoxElement.addEventListener(
      ConnectedSearchBox.CLEARED_AUTOCOMPLETE_EVENT_NAME,
      clearHandler
    );

    // Act.
    const root = getShadowRoot(ConnectedSearchBox.tagName);
    const textField = root.querySelector("#search") as HTMLInputElement;
    // Make it look like the user hit a key.
    textField.dispatchEvent(new KeyboardEvent("keypress", { key: "a" }));

    // Assert.
    // It should not have fired any events.
    expect(searchBeginHandler).not.toBeCalled();
    expect(clearHandler).not.toBeCalled();
  });

  it("clears any text when we click the clear button", async () => {
    // Arrange.
    // Listen for the events.
    const clearHandler = jest.fn();
    searchBoxElement.addEventListener(
      ConnectedSearchBox.CLEARED_AUTOCOMPLETE_EVENT_NAME,
      clearHandler
    );

    // Add some text to the search box.
    const root = getShadowRoot(ConnectedSearchBox.tagName);
    const textField = root.querySelector("#search") as HTMLInputElement;
    textField.value = faker.lorem.words();
    // Force it to update the showClear state value.
    textField.dispatchEvent(new InputEvent("input", {}));

    // Do a preliminary render to make sure the clear button shows.
    await searchBoxElement.updateComplete;

    // Act.
    // Simulate a click on the clear button.
    const clearButton = root.querySelector("#clear_button") as HTMLElement;
    clearButton.dispatchEvent(new Event("click", {}));
    await searchBoxElement.updateComplete;

    // Assert.
    // It should have removed the search text.
    expect(textField.value).toEqual("");
    // It should have dispatched the clear event.
    expect(clearHandler).toBeCalledTimes(1);
  });

  each([
    ["running", RequestState.LOADING],
    ["finished", RequestState.SUCCEEDED],
  ]).it(
    "updates the properties from the Redux state when the search request is %s",
    (_, queryState: RequestState) => {
      // Arrange.
      // Create a fake state.
      const state = fakeState();
      const searchState = state.imageView.search;
      searchState.autocompleteSuggestions = [
        faker.lorem.words(),
        faker.lorem.words(),
      ];
      searchState.queryState = queryState;

      // Act.
      const updates = searchBoxElement.mapState(state);

      // Assert.
      // It should have gotten the correct updates.
      expect(updates).toHaveProperty("autocompleteSuggestions");
      expect(updates["autocompleteSuggestions"]).toEqual(
        searchState.autocompleteSuggestions
      );

      expect(updates).toHaveProperty("showProgress");
      expect(updates["showProgress"]).toEqual(
        queryState == RequestState.LOADING
      );
    }
  );

  each([
    ["too short", "ab"],
    ["long enough", "search string"],
  ]).it(
    `maps the correct actions to the ${ConnectedSearchBox.SEARCH_STRING_CHANGED_EVENT_NAME} event when the search string is %s`,
    (_, searchString: string) => {
      // Act.
      const eventMap = searchBoxElement.mapEvents();

      // Assert.
      // It should have a mapping for the proper events.
      expect(eventMap).toHaveProperty(
        ConnectedSearchBox.SEARCH_STRING_CHANGED_EVENT_NAME
      );

      // This should fire the appropriate action creator.
      const testEvent = new CustomEvent(
        ConnectedSearchBox.SEARCH_STRING_CHANGED_EVENT_NAME,
        { detail: searchString }
      );
      eventMap[ConnectedSearchBox.SEARCH_STRING_CHANGED_EVENT_NAME](testEvent);

      if (searchString.length < 3) {
        // It should not be showing autocomplete.
        expect(mockClearAutocomplete).toBeCalledTimes(1);
      } else {
        // It should be showing autocomplete.
        expect(mockThunkDoAutocomplete).toBeCalledWith({
          searchString: searchString,
          numSuggestions: expect.anything(),
        });
      }
    }
  );

  it(`maps the correct actions to the ${ConnectedSearchBox.SEARCH_STARTED_EVENT_NAME} event`, () => {
    // Act.
    const eventMap = searchBoxElement.mapEvents();

    // Assert.
    // It should have a mapping for the proper events.
    expect(eventMap).toHaveProperty(
      ConnectedSearchBox.SEARCH_STARTED_EVENT_NAME
    );

    // This should fire the appropriate action creator.
    const searchString = faker.lorem.words();
    const testEvent = new CustomEvent(
      ConnectedSearchBox.SEARCH_STARTED_EVENT_NAME,
      { detail: searchString }
    );
    eventMap[ConnectedSearchBox.SEARCH_STARTED_EVENT_NAME](testEvent);

    expect(mockThunkTextSearch).toBeCalledWith(testEvent.detail);
  });

  it(`maps the correct actions to the ${ConnectedSearchBox.CLEARED_AUTOCOMPLETE_EVENT_NAME} event`, () => {
    // Act.
    const eventMap = searchBoxElement.mapEvents();

    // Assert.
    // It should have a mapping for the proper events.
    expect(eventMap).toHaveProperty(
      ConnectedSearchBox.CLEARED_AUTOCOMPLETE_EVENT_NAME
    );

    // This should fire the appropriate action creator.
    const testEvent = new CustomEvent(
      ConnectedSearchBox.CLEARED_AUTOCOMPLETE_EVENT_NAME
    );
    eventMap[ConnectedSearchBox.CLEARED_AUTOCOMPLETE_EVENT_NAME](testEvent);

    expect(mockClearAutocomplete).toBeCalledTimes(1);
  });
});
