import { ConnectedTopNavBar } from "../top-nav-bar";
import { fakeState, getShadowRoot } from "./element-test-utils";
import each from "jest-each";
import { TopAppBarFixed } from "@material/mwc-top-app-bar-fixed";
import { IconButton } from "@material/mwc-icon-button";
import {
  thunkBulkDownloadSelected,
  thunkSelectAll,
} from "../thumbnail-grid-slice";

// I know this sounds insane, but when I import this as an ES6 module, faker.seed() comes up
// undefined. I can only assume this is a quirk in Babel.
const faker = require("faker");

// Create the mocks.
jest.mock("../thumbnail-grid-slice", () => {
  const actualSlice = jest.requireActual("../thumbnail-grid-slice");
  return {
    thunkBulkDownloadSelected: jest.fn(),
    thunkSelectAll: jest.fn(),

    // Use the actual implementation for this function.
    thumbnailGridSelectors: {
      selectIds: actualSlice.thumbnailGridSelectors.selectIds,
    },
  };
});
const mockThunkBulkDownloadSelected =
  thunkBulkDownloadSelected as jest.MockedFn<typeof thunkBulkDownloadSelected>;
const mockSelectAll = thunkSelectAll as jest.MockedFn<typeof thunkSelectAll>;

jest.mock("@captaincodeman/redux-connect-element", () => ({
  // Turn connect() into a pass-through.
  connect: jest.fn((_, elementClass) => elementClass),
}));
jest.mock("../store", () => ({
  // Mock this to avoid an annoying spurious console error from Redux.
  configureStore: jest.fn(),
}));

describe("top-nav-bar", () => {
  /** Internal top-nav-bar to use for testing. */
  let navBarElement: ConnectedTopNavBar;

  beforeAll(() => {
    // Manually register the custom element.
    customElements.define(ConnectedTopNavBar.tagName, ConnectedTopNavBar);
  });

  beforeEach(() => {
    // Set a faker seed.
    faker.seed(1337);

    navBarElement = window.document.createElement(
      ConnectedTopNavBar.tagName
    ) as ConnectedTopNavBar;
    document.body.appendChild(navBarElement);
  });

  afterEach(() => {
    document.body.getElementsByTagName(ConnectedTopNavBar.tagName)[0].remove();
  });

  it("renders the title correctly", async () => {
    // Arrange.
    // Set the title.
    const fakeTitle = faker.lorem.sentence();

    // Act.
    navBarElement.title = fakeTitle;
    await navBarElement.updateComplete;

    // Assert.
    const root = getShadowRoot(ConnectedTopNavBar.tagName);
    const topBar = root.querySelector("#app_bar");
    expect(topBar).not.toBe(null);

    // It should have rendered the title.
    const titleDiv = topBar?.querySelector("span");
    expect(titleDiv).not.toBe(null);
    expect(titleDiv?.textContent).toContain(fakeTitle);
  });

  it("renders correctly when items are selected", async () => {
    // Act.
    // Make it look like items are selected.
    navBarElement.numItemsSelected = faker.datatype.number({ min: 1 });
    await navBarElement.updateComplete;

    // Assert.
    const root = getShadowRoot(ConnectedTopNavBar.tagName);
    const topBar = root.querySelector("#app_bar");
    expect(topBar).not.toBeNull();

    // It should have rendered the download button.
    const downloadButton = topBar?.querySelector("#download_button");
    expect(downloadButton).not.toBeNull();

    // It should have rendered a message about the number of items selected.
    const title = topBar?.querySelector("#title") as HTMLElement;
    expect(title.innerHTML).toContain(
      `${navBarElement.numItemsSelected} Selected`
    );

    // It should also show a button to cancel the selection.
    const cancelButton = topBar?.querySelector(
      "#cancel_selection"
    ) as IconButton;
    expect(cancelButton).not.toBeNull();

    // It should not show the search box in this mode.
    expect(topBar?.querySelector("#search")).toBeNull();
  });

  it("dispatches an event when the download button is clicked", async () => {
    // Arrange.
    // Make it look like items are selected.
    navBarElement.numItemsSelected = 3;
    await navBarElement.updateComplete;

    // Add a handler for the event.
    const downloadHandler = jest.fn();
    navBarElement.addEventListener(
      ConnectedTopNavBar.DOWNLOAD_STARTED_EVENT_NAME,
      downloadHandler
    );

    // Act.
    // Simulate a click on the download button.
    const root = getShadowRoot(ConnectedTopNavBar.tagName);
    const topBar = root.querySelector("#app_bar") as TopAppBarFixed;
    const downloadButton = topBar.querySelector(
      "#download_button"
    ) as IconButton;

    downloadButton.dispatchEvent(new MouseEvent("click"));

    // Assert.
    // It should have fired the event.
    expect(downloadHandler).toBeCalledTimes(1);
  });

  it("dispatches an event when the cancel selection button is clicked", async () => {
    // Arrange.
    // Make it look like items are selected.
    navBarElement.numItemsSelected = 3;
    await navBarElement.updateComplete;

    // Add a handler for the event.
    const cancelHandler = jest.fn();
    navBarElement.addEventListener(
      ConnectedTopNavBar.SELECT_CANCEL_EVENT_NAME,
      cancelHandler
    );

    // Act.
    // Simulate a click on the cancel button.
    const root = getShadowRoot(ConnectedTopNavBar.tagName);
    const topBar = root.querySelector("#app_bar") as TopAppBarFixed;
    const cancelButton = topBar.querySelector(
      "#cancel_selection"
    ) as IconButton;

    cancelButton.dispatchEvent(new MouseEvent("click"));

    // Assert.
    // It should have fired the event.
    expect(cancelHandler).toBeCalledTimes(1);
  });

  each([
    ["shows", true],
    ["hides", false],
  ]).it(
    "%s the back button when requested",
    async (_: string, showBack: boolean) => {
      // Act.
      navBarElement.showBack = showBack;
      await navBarElement.updateComplete;

      // Assert.
      const root = getShadowRoot(ConnectedTopNavBar.tagName);

      // Check the status of the back button.
      const backButton = root.querySelector("#back_button");
      expect(backButton).not.toBe(null);

      if (!showBack) {
        // This button should be hidden.
        expect(backButton?.classList).toContain("hidden");
      } else {
        // This button should be showing.
        expect(backButton?.classList).not.toContain("hidden");
      }
    }
  );

  it("goes back when the back button is clicked", async () => {
    // Arrange.
    // Wait for it to render.
    await navBarElement.updateComplete;

    // Monitor the history object, so we can detect the callback.
    const backSpy = jest.spyOn(history, "back");
    backSpy.mockClear();

    // Act.
    const root = getShadowRoot(ConnectedTopNavBar.tagName);

    // Make it look like the button was clicked.
    const backButton = root.querySelector("#back_button") as HTMLElement;
    backButton.dispatchEvent(new Event("click"));

    // Assert.
    // It should have gone back.
    expect(backSpy).toBeCalledTimes(1);
  });

  it("updates the properties from the Redux state", () => {
    // Arrange.
    // Create a fake state.
    const state = fakeState();
    const imageView = state.imageView;
    imageView.numItemsSelected = faker.datatype.number();

    // Act.
    const updates = navBarElement.mapState(state);

    // Assert.
    // It should have updated the selection state.
    expect(updates).toHaveProperty("numItemsSelected");
    expect(updates.numItemsSelected).toEqual(imageView.numItemsSelected);
  });

  it(`fires the correct action creator for the ${ConnectedTopNavBar.DOWNLOAD_STARTED_EVENT_NAME} event`, () => {
    // Arrange.
    const eventMap = navBarElement.mapEvents();

    // Act.
    eventMap[ConnectedTopNavBar.DOWNLOAD_STARTED_EVENT_NAME](
      new CustomEvent<void>(ConnectedTopNavBar.DOWNLOAD_STARTED_EVENT_NAME)
    );

    // Assert.
    // It should have a mapping for the event.
    expect(eventMap).toHaveProperty(
      ConnectedTopNavBar.DOWNLOAD_STARTED_EVENT_NAME
    );

    // It should have used the correct action creator.
    expect(mockThunkBulkDownloadSelected).toBeCalledTimes(1);
  });

  it(`fires the correct action creator for the ${ConnectedTopNavBar.SELECT_CANCEL_EVENT_NAME} event`, () => {
    // Arrange.
    const eventMap = navBarElement.mapEvents();

    // Act.
    eventMap[ConnectedTopNavBar.SELECT_CANCEL_EVENT_NAME](
      new CustomEvent<void>(ConnectedTopNavBar.SELECT_CANCEL_EVENT_NAME)
    );

    // Assert.
    // It should have a mapping for the event.
    expect(eventMap).toHaveProperty(
      ConnectedTopNavBar.SELECT_CANCEL_EVENT_NAME
    );

    // It should have used the correct action creator.
    expect(mockSelectAll).toBeCalledWith(false);
  });
});
