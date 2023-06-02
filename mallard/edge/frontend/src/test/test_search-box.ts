import {
  setSearchString,
  thunkDoAutocomplete,
  thunkTextSearch,
} from "../thumbnail-grid-slice";
import { ConnectedSearchBox } from "../search-box";
import each from "jest-each";
import {
  fakeState,
  fakeSuggestions,
  getShadowRoot,
} from "./element-test-utils";
import { RequestState } from "../types";
import {
  AutocompleteMenu,
  completeSearch,
  completeToken,
} from "../autocomplete";
import { AppDatePicker } from "app-datepicker";
import { Dialog } from "@material/mwc-dialog";
import { TextField } from "@material/mwc-textfield";
import { faker } from "@faker-js/faker";

jest.mock("../thumbnail-grid-slice", () => {
  return {
    setSearchString: jest.fn(),
    thunkDoAutocomplete: jest.fn(),
    thunkTextSearch: jest.fn(),
  };
});
const mockSetSearchString = setSearchString as jest.MockedFn<
  typeof setSearchString
>;
const mockThunkDoAutocomplete = thunkDoAutocomplete as jest.MockedFn<
  typeof thunkDoAutocomplete
>;
const mockThunkTextSearch = thunkTextSearch as jest.MockedFn<
  typeof thunkTextSearch
>;

jest.mock("@captaincodeman/redux-connect-element", () => ({
  // Turn connect() into a pass-through.
  connect: jest.fn((_, elementClass) => elementClass),
}));
jest.mock("../store", () => ({
  // Mock this to avoid an annoying spurious console error from Redux.
  configureStore: jest.fn(),
}));

jest.mock("../autocomplete", () => {
  const realAutocomplete = jest.requireActual("../autocomplete");

  return {
    AutocompleteMenu: realAutocomplete.AutocompleteMenu,
    completeToken: jest.fn(),
    completeSearch: jest.fn(),
  };
});
const mockCompleteToken = completeToken as jest.MockedFn<typeof completeToken>;
const mockCompleteSearch = completeSearch as jest.MockedFn<
  typeof completeSearch
>;

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

  it("renders the date autocomplete menu", async () => {
    // Arrange.
    // Show the menu.
    searchBoxElement.autocompleteMenu = AutocompleteMenu.DATE;

    // Act.
    await searchBoxElement.updateComplete;

    // Assert.
    const root = getShadowRoot(ConnectedSearchBox.tagName);
    const autocompleteDiv = root.querySelector(
      ".autocomplete-background"
    ) as HTMLElement;

    // It should have rendered the menu.
    const buttons = autocompleteDiv.querySelectorAll("mwc-button");
    expect(buttons).toHaveLength(3);
    expect(buttons[0].label).toEqual("before");
    expect(buttons[1].label).toEqual("date");
    expect(buttons[2].label).toEqual("after");
  });

  it("renders the platform autocomplete menu", async () => {
    // Arrange.
    // Show the menu.
    searchBoxElement.autocompleteMenu = AutocompleteMenu.PLATFORM;

    // Act.
    await searchBoxElement.updateComplete;

    // Assert.
    const root = getShadowRoot(ConnectedSearchBox.tagName);
    const autocompleteDiv = root.querySelector(
      ".autocomplete-background"
    ) as HTMLElement;

    // It should have rendered the menu.
    const buttons = autocompleteDiv.querySelectorAll("mwc-button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0].label).toEqual("ground");
    expect(buttons[1].label).toEqual("aerial");
  });

  it("updates the value in the search box when the property changes", async () => {
    // Act.
    // Set the text property.
    searchBoxElement.searchString = faker.lorem.words();
    await searchBoxElement.updateComplete;

    // Assert.
    // It should have set the text in the actual text box.
    const root = getShadowRoot(ConnectedSearchBox.tagName);
    const textField = root.querySelector("#search") as HTMLInputElement;
    expect(textField.value).toEqual(searchBoxElement.searchString);
  });

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
      ConnectedSearchBox.HIDE_AUTOCOMPLETE_EVENT_NAME,
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
      ConnectedSearchBox.HIDE_AUTOCOMPLETE_EVENT_NAME,
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

  each([
    ["with ellipses", "..."],
    ["without ellipses", ""],
  ]).it(
    "starts a search when we click on a suggestion %s",
    async (_, padding: string) => {
      // Arrange.
      // Add some suggestions.
      const firstSuggestion = faker.lorem.words();
      const paddedFirstSuggestion = `${padding}${firstSuggestion}${padding}`;
      searchBoxElement.autocompleteSuggestions = [
        paddedFirstSuggestion,
        faker.lorem.words(),
      ];
      searchBoxElement.autocompleteMenu = AutocompleteMenu.NONE;
      await searchBoxElement.updateComplete;

      // Set an existing search string.
      const root = getShadowRoot(ConnectedSearchBox.tagName);
      const searchBox = root.querySelector("#search") as TextField;
      const initialSearchString = faker.lorem.words();
      searchBox.value = initialSearchString;

      // Make it look like the search completion works.
      const completedSearch = faker.lorem.words();
      mockCompleteSearch.mockReturnValue(completedSearch);

      // Listen for the search events.
      const searchStartedEventListener = jest.fn();
      const clearedAutocompleteEventListener = jest.fn();
      searchBoxElement.addEventListener(
        ConnectedSearchBox.SEARCH_STARTED_EVENT_NAME,
        searchStartedEventListener
      );
      searchBoxElement.addEventListener(
        ConnectedSearchBox.HIDE_AUTOCOMPLETE_EVENT_NAME,
        clearedAutocompleteEventListener
      );

      // Act.
      // Simulate a click on the suggestion.
      const suggestionListElement = root.querySelector(
        "mwc-list"
      ) as HTMLElement;
      const listElements =
        suggestionListElement.querySelectorAll("mwc-list-item");

      expect(listElements).toHaveLength(2);
      const firstElement = listElements[0];
      // For some reason, this has to be set manually to show up in the event
      // target. Idiosyncrasy with JSDom?
      firstElement.innerText = paddedFirstSuggestion;
      firstElement.dispatchEvent(new MouseEvent("click", {}));

      // It should have started the search.
      expect(searchStartedEventListener).toBeCalledTimes(1);
      expect(clearedAutocompleteEventListener).toBeCalledTimes(1);

      // It should have used the correct search string.
      expect(mockCompleteSearch).toBeCalledWith(
        initialSearchString,
        firstSuggestion
      );
      expect(searchBox.value).toEqual(completedSearch);
    }
  );

  it("clears any text when we click the clear button", async () => {
    // Arrange.
    // Listen for the events.
    const clearHandler = jest.fn();
    searchBoxElement.addEventListener(
      ConnectedSearchBox.CLEAR_SEARCH_STRING_EVENT_NAME,
      clearHandler
    );

    // Add some text to the search box.
    const root = getShadowRoot(ConnectedSearchBox.tagName);
    const textField = root.querySelector("#search") as HTMLInputElement;
    textField.value = faker.lorem.words();
    // Force it to show the clear button.
    searchBoxElement.showClear = true;

    // Do a preliminary render to make sure the clear button shows.
    await searchBoxElement.updateComplete;

    // Act.
    // Simulate a click on the clear button.
    const clearButton = root.querySelector("#clear_button") as HTMLElement;
    clearButton.dispatchEvent(new Event("click", {}));
    await searchBoxElement.updateComplete;

    // Assert.
    // It should have dispatched the clear event.
    expect(clearHandler).toBeCalledTimes(1);
  });

  each([
    ["before", 0, "before"],
    ["date", 1, "date"],
    ["after", 2, "after"],
  ]).it(
    "goes through the date selection workflow when we click the %s button",
    async (_, buttonIndex: number, directive: string) => {
      // Arrange.
      // Show the date menu.
      searchBoxElement.autocompleteMenu = AutocompleteMenu.DATE;
      await searchBoxElement.updateComplete;

      // Find the button.
      const root = getShadowRoot(ConnectedSearchBox.tagName);
      const autocompleteDiv = root.querySelector(
        ".autocomplete-background"
      ) as HTMLElement;
      const button =
        autocompleteDiv.querySelectorAll("mwc-button")[buttonIndex];

      // Add a listener for the event signaling that the search string has
      // changed.
      const searchStringChangedListener = jest.fn();
      searchBoxElement.addEventListener(
        ConnectedSearchBox.SEARCH_STRING_CHANGED_EVENT_NAME,
        searchStringChangedListener
      );

      // Set a value for the date picker.
      const selectedDate = faker.date.past().toISOString();
      const datePicker = root.querySelector("#date_picker") as AppDatePicker;
      datePicker.value = selectedDate;

      // Find the date picker dialog button.
      const datePickerDialog = root.querySelector(
        "#date_picker_dialog"
      ) as Dialog;
      const dialogCloseButton =
        datePickerDialog.querySelectorAll("mwc-button")[0];

      // Make it look like completing the token works.
      const searchBox = root.querySelector("#search") as TextField;
      const initialSearchString = faker.lorem.words();
      const completedSearchString = faker.lorem.words();
      searchBox.value = initialSearchString;
      mockCompleteToken.mockReturnValue(completedSearchString);

      // Act.
      // Simulate a click on the button.
      button.dispatchEvent(new MouseEvent("click", {}));
      // Simulate a click on the dialog OK button.
      dialogCloseButton.dispatchEvent(new MouseEvent("click", {}));

      // Assert.
      // It should have fired the event.
      expect(searchStringChangedListener).toBeCalledTimes(1);

      // It should have added the proper directive to the search string.
      expect(searchBox.value).toEqual(completedSearchString);
      expect(mockCompleteToken).toBeCalledWith(
        initialSearchString,
        `${directive}:${selectedDate}`
      );
    }
  );

  each([
    ["ground", 0, "ground"],
    ["aerial", 1, "aerial"],
  ]).it(
    "adds a platform directive when we click the %s button",
    async (_, buttonIndex: number, condition: string) => {
      // Arrange.
      // Show the platform menu.
      searchBoxElement.autocompleteMenu = AutocompleteMenu.PLATFORM;
      await searchBoxElement.updateComplete;

      // Find the button.
      const root = getShadowRoot(ConnectedSearchBox.tagName);
      const autocompleteDiv = root.querySelector(
        ".autocomplete-background"
      ) as HTMLElement;
      const button =
        autocompleteDiv.querySelectorAll("mwc-button")[buttonIndex];

      // Add a listener for the event signaling that the search string has
      // changed.
      const searchStringChangedListener = jest.fn();
      searchBoxElement.addEventListener(
        ConnectedSearchBox.SEARCH_STRING_CHANGED_EVENT_NAME,
        searchStringChangedListener
      );

      // Make it look like completing the token works.
      const searchBox = root.querySelector("#search") as TextField;
      const initialSearchString = faker.lorem.words();
      const completedSearchString = faker.lorem.words();
      searchBox.value = initialSearchString;
      mockCompleteToken.mockReturnValue(completedSearchString);

      // Act.
      // Simulate a click on the button.
      button.dispatchEvent(new MouseEvent("click", {}));

      // Assert.
      // It should have fired the event.
      expect(searchStringChangedListener).toBeCalledTimes(1);

      // It should have added the proper directive to the search string.
      expect(searchBox.value).toEqual(completedSearchString);
      expect(mockCompleteToken).toBeCalledWith(
        initialSearchString,
        `platform:${condition}`
      );
    }
  );

  each([
    ["search request is running", RequestState.LOADING, faker.lorem.words()],
    ["search request is finished", RequestState.SUCCEEDED, faker.lorem.words()],
    ["search string is empty", RequestState.SUCCEEDED, ""],
  ]).it(
    "updates the properties from the Redux state when the %s",
    (_, queryState: RequestState, searchString: string) => {
      // Arrange.
      // Create a fake state.
      const state = fakeState();
      const searchState = state.imageView.search;
      searchState.autocompleteSuggestions = fakeSuggestions();
      searchState.queryState = queryState;
      searchState.searchString = searchString;

      // Act.
      const updates = searchBoxElement.mapState(state);

      // Assert.
      // It should have gotten the correct updates.
      expect(updates).toHaveProperty("autocompleteSuggestions");
      expect(updates["autocompleteSuggestions"]).toEqual(
        searchState.autocompleteSuggestions.textCompletions
      );
      expect(updates["autocompleteMenu"]).toEqual(
        searchState.autocompleteSuggestions.menu
      );

      expect(updates).toHaveProperty("showProgress");
      expect(updates["showProgress"]).toEqual(
        queryState == RequestState.LOADING
      );

      expect(updates).toHaveProperty("searchString");
      expect(updates["searchString"]).toEqual(searchString);

      expect(updates).toHaveProperty("showClear");
      expect(updates["showClear"]).toEqual(searchString.length > 0);
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
        expect(mockSetSearchString).toBeCalledWith({
          searchString: searchString,
          clearAutocomplete: true,
        });
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

  it(`maps the correct actions to the ${ConnectedSearchBox.HIDE_AUTOCOMPLETE_EVENT_NAME} event`, () => {
    // Act.
    const eventMap = searchBoxElement.mapEvents();

    // Assert.
    // It should have a mapping for the proper events.
    expect(eventMap).toHaveProperty(
      ConnectedSearchBox.HIDE_AUTOCOMPLETE_EVENT_NAME
    );

    // This should fire the appropriate action creator.
    const testEvent = new CustomEvent(
      ConnectedSearchBox.HIDE_AUTOCOMPLETE_EVENT_NAME
    );
    eventMap[ConnectedSearchBox.HIDE_AUTOCOMPLETE_EVENT_NAME](testEvent);

    expect(mockSetSearchString).toBeCalledTimes(1);
    expect(mockSetSearchString).toBeCalledWith({ clearAutocomplete: true });
  });

  it(`maps the correct actions to the ${ConnectedSearchBox.CLEAR_SEARCH_STRING_EVENT_NAME} event`, () => {
    // Act.
    const eventMap = searchBoxElement.mapEvents();

    // Assert.
    // It should have a mapping for the proper events.
    expect(eventMap).toHaveProperty(
      ConnectedSearchBox.CLEAR_SEARCH_STRING_EVENT_NAME
    );

    // This should fire the appropriate action creator.
    const testEvent = new CustomEvent(
      ConnectedSearchBox.CLEAR_SEARCH_STRING_EVENT_NAME
    );
    eventMap[ConnectedSearchBox.CLEAR_SEARCH_STRING_EVENT_NAME](testEvent);

    expect(mockSetSearchString).toBeCalledTimes(1);
    expect(mockSetSearchString).toBeCalledWith({
      searchString: "",
      clearAutocomplete: true,
    });
  });
});
