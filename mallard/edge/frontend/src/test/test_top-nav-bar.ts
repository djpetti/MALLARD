import { ConnectedTopNavBar, TopNavBar } from "../top-nav-bar";
import { fakeState, getShadowRoot } from "./element-test-utils";
import each from "jest-each";
import { TopAppBarFixed } from "@material/mwc-top-app-bar-fixed";
import { IconButton } from "@material/mwc-icon-button";
import {
  thunkBulkDownloadSelected,
  thunkClearExportedImages,
  thunkDeleteSelected,
  thunkExportSelected,
  thunkSelectAll,
} from "../thumbnail-grid-slice";
import { Dialog } from "@material/mwc-dialog";
import { Button } from "@material/mwc-button";
import { RequestState } from "../types";
import { Menu } from "@material/mwc-menu";
import { ListItem } from "@material/mwc-list/mwc-list-item";
import { faker } from "@faker-js/faker";

// Create the mocks.
jest.mock("../thumbnail-grid-slice", () => {
  const actualSlice = jest.requireActual("../thumbnail-grid-slice");
  return {
    thunkBulkDownloadSelected: jest.fn(),
    thunkDeleteSelected: jest.fn(),
    thunkSelectAll: jest.fn(),
    thunkExportSelected: jest.fn(),
    thunkClearExportedImages: jest.fn(),

    // Use the actual implementation for this function.
    thumbnailGridSelectors: {
      selectIds: actualSlice.thumbnailGridSelectors.selectIds,
    },
  };
});
const mockBulkDownloadSelected = thunkBulkDownloadSelected as jest.MockedFn<
  typeof thunkBulkDownloadSelected
>;
const mockDeleteSelected = thunkDeleteSelected as jest.MockedFn<
  typeof thunkDeleteSelected
>;
const mockSelectAll = thunkSelectAll as jest.MockedFn<typeof thunkSelectAll>;
const mockExportSelected = thunkExportSelected as jest.MockedFn<
  typeof thunkExportSelected
>;
const mockClearExportedImages = thunkClearExportedImages as jest.MockedFn<
  typeof thunkClearExportedImages
>;

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

  it("renders correctly by default", async () => {
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
    const titleSpan = topBar?.querySelector("span");
    expect(titleSpan).not.toBe(null);
    expect(titleSpan?.textContent).toContain(fakeTitle);
    expect(titleSpan?.classList).toContainEqual("logo");

    // It should have rendered the dialog, but not opened it.
    const deleteConfirmDialog = root.querySelector("#confirm_delete_dialog");
    expect(deleteConfirmDialog).not.toBeNull();
    expect((deleteConfirmDialog as Dialog).open).toEqual(false);

    // Both buttons should be visible and enabled.
    const buttons = deleteConfirmDialog?.querySelectorAll(
      "mwc-button"
    ) as NodeListOf<Button>;
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button.disabled).toEqual(false);
    }
  });

  it("renders when showing the deletion progress indicator", async () => {
    // Arrange.
    // Show the progress indicator.
    navBarElement.showDeletionProgress = true;

    // Act.
    await navBarElement.updateComplete;

    // Assert.
    const root = getShadowRoot(ConnectedTopNavBar.tagName);
    const topBar = root.querySelector("#app_bar");
    expect(topBar).not.toBe(null);

    // It should have rendered the dialog.
    const deleteConfirmDialog = root.querySelector("#confirm_delete_dialog");
    expect(deleteConfirmDialog).not.toBeNull();

    // Only the cancel button should be visible and disabled.
    const buttons = deleteConfirmDialog?.querySelectorAll(
      "mwc-button"
    ) as NodeListOf<Button>;
    expect(buttons).toHaveLength(1);
    expect(buttons[0].disabled).toEqual(true);

    // The delete button should have been replaced by a loading indicator.
    const loader = root.querySelector("mwc-circular-progress");
    expect(loader).not.toBeNull();
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
    // It should have used the default style instead of the special logo style.
    expect(title.classList).not.toContain("logo");

    // It should also show a button to cancel the selection.
    const cancelButton = topBar?.querySelector(
      "#cancel_selection"
    ) as IconButton;
    expect(cancelButton).not.toBeNull();

    // It should not show the search box in this mode.
    expect(topBar?.querySelector("#search")).toBeNull();

    // It should have rendered the overflow menu, but not opened it.
    const menu = root.querySelector("#more_actions_menu");
    expect(menu).not.toBeNull();
    expect((menu as Menu).open).toEqual(false);
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

  it("opens the confirmation when the delete button is clicked", async () => {
    // Arrange.
    // Make it look like items are selected.
    navBarElement.numItemsSelected = 3;
    await navBarElement.updateComplete;

    // Act.
    // Simulate a click on the delete button.
    const root = getShadowRoot(ConnectedTopNavBar.tagName);
    const topBar = root.querySelector("#app_bar") as TopAppBarFixed;
    const deleteButton = topBar.querySelector("#delete_button") as IconButton;

    deleteButton.dispatchEvent(new MouseEvent("click"));

    await navBarElement.updateComplete;

    // Assert.
    // It should have opened the confirmation dialog.
    const dialog = root.querySelector("#confirm_delete_dialog");
    expect(dialog).not.toBeNull();
    expect((dialog as Dialog).open).toEqual(true);
  });

  it("dispatches an event when the user confirms the deletion", async () => {
    // Arrange.
    // Make it look like items are selected.
    navBarElement.numItemsSelected = 3;
    await navBarElement.updateComplete;

    // Add a handler for the event.
    const deleteHandler = jest.fn();
    navBarElement.addEventListener(
      ConnectedTopNavBar.DELETE_EVENT_NAME,
      deleteHandler
    );

    // Act.
    // Simulate a click on the delete button.
    const root = getShadowRoot(ConnectedTopNavBar.tagName);
    const deleteButton = root.querySelector("#delete_confirm_button") as Button;
    expect(deleteButton).not.toBeNull();

    deleteButton.dispatchEvent(new MouseEvent("click"));

    await navBarElement.updateComplete;

    // Assert.
    // It should have fired the event.
    expect(deleteHandler).toBeCalledTimes(1);
  });

  it("opens the overflow menu when the button is clicked", async () => {
    // Arrange.
    // Make it look like items are selected.
    navBarElement.numItemsSelected = 3;
    await navBarElement.updateComplete;

    // Act.
    // Simulate a click on the overflow button.
    const root = getShadowRoot(ConnectedTopNavBar.tagName);
    const topBar = root.querySelector("#app_bar") as TopAppBarFixed;
    const moreActionsButton = topBar.querySelector(
      "#more_actions_button"
    ) as IconButton;

    moreActionsButton.dispatchEvent(new MouseEvent("click"));

    await navBarElement.updateComplete;

    // Assert.
    // It should have opened the overflow menu.
    const menu = root.querySelector("#more_actions_menu") as Menu;
    expect(menu).not.toBeNull();
    expect(menu.open).toEqual(true);

    // It should have anchored the menu to the button.
    expect(menu.anchor).toEqual(moreActionsButton);
  });

  it("dispatches an event when the user exports a list of URLs", async () => {
    // Arrange.
    // Make it look like items are selected.
    navBarElement.numItemsSelected = 3;
    await navBarElement.updateComplete;

    // Add a handler for the event.
    const exportHandler = jest.fn();
    navBarElement.addEventListener(
      ConnectedTopNavBar.URL_EXPORT_EVENT_NAME,
      exportHandler
    );

    // Act.
    // Simulate a click on the delete button.
    const root = getShadowRoot(ConnectedTopNavBar.tagName);
    const overflowMenu = root.querySelector("#more_actions_menu") as Menu;
    const exportOption = overflowMenu.querySelectorAll(
      "mwc-list-item"
    )[0] as ListItem;
    expect(exportOption).not.toBeNull();

    exportOption.dispatchEvent(new MouseEvent("click"));

    await navBarElement.updateComplete;

    // Assert.
    // It should have fired the event.
    expect(exportHandler).toBeCalledTimes(1);
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

  it("closes the dialog when the deletion action completes", async () => {
    // Arrange.
    // Initially, make it look like deletion is in-progress.
    navBarElement.showDeletionProgress = true;

    // Open the dialog.
    const root = getShadowRoot(ConnectedTopNavBar.tagName);
    const dialog = root.querySelector("#confirm_delete_dialog") as Dialog;
    dialog.show();

    await navBarElement.updateComplete;
    expect(dialog.open).toEqual(true);

    // Act.
    // Make it look like the deletion action finished.
    navBarElement.showDeletionProgress = false;
    await navBarElement.updateComplete;

    // Assert.
    // It should have closed the dialog.
    expect(dialog.open).toEqual(false);
  });

  it("starts the download when the exported URLs are ready", async () => {
    // Arrange.
    // Add a handler for the "export finished" event.
    const exportFinishedHandler = jest.fn();
    navBarElement.addEventListener(
      TopNavBar.URL_EXPORT_FINISHED_EVENT_NAME,
      exportFinishedHandler
    );

    const downloadLink = faker.internet.url();

    // Act.
    // Make it look like the download is ready.
    navBarElement.exportedUrlFileLink = downloadLink;
    await navBarElement.updateComplete;

    // Assert.
    // It should have fired the event.
    expect(exportFinishedHandler).toBeCalledTimes(1);

    // It should have rendered the hidden link.
    const root = getShadowRoot(ConnectedTopNavBar.tagName);
    const link = root.querySelector("#download_link") as HTMLLinkElement;
    expect(link).not.toBeNull();
    expect(link.href).toContain(downloadLink);
  });

  each([
    ["deletion is running", RequestState.LOADING],
    ["deletion is finished", RequestState.SUCCEEDED],
  ]).it(
    "updates the properties from the Redux state when %s",
    (_, deletionState: RequestState) => {
      // Arrange.
      // Create a fake state.
      const state = fakeState();
      const imageView = state.imageView;
      imageView.numItemsSelected = faker.datatype.number();
      imageView.imageDeletionState = deletionState;

      // Act.
      const updates = navBarElement.mapState(state);

      // Assert.
      // It should have updated the selection state.
      expect(updates).toHaveProperty("numItemsSelected");
      expect(updates.numItemsSelected).toEqual(imageView.numItemsSelected);

      // It should have updated the deletion state.
      expect(updates).toHaveProperty("showDeletionProgress");
      expect(updates.showDeletionProgress).toEqual(
        deletionState == RequestState.LOADING
      );
    }
  );

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
    expect(mockBulkDownloadSelected).toBeCalledTimes(1);
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

  it(`fires the correct action creator for the ${ConnectedTopNavBar.DELETE_EVENT_NAME} event`, () => {
    // Arrange.
    const eventMap = navBarElement.mapEvents();

    // Act.
    eventMap[ConnectedTopNavBar.DELETE_EVENT_NAME](
      new CustomEvent<void>(ConnectedTopNavBar.DELETE_EVENT_NAME)
    );

    // Assert.
    // It should have a mapping for the event.
    expect(eventMap).toHaveProperty(ConnectedTopNavBar.DELETE_EVENT_NAME);

    // It should have used the correct action creator.
    expect(mockDeleteSelected).toBeCalledWith();
  });

  it(`fires the correct action creator for the ${ConnectedTopNavBar.URL_EXPORT_EVENT_NAME} event`, () => {
    // Arrange.
    const eventMap = navBarElement.mapEvents();

    // Act.
    eventMap[ConnectedTopNavBar.URL_EXPORT_EVENT_NAME](
      new CustomEvent<void>(ConnectedTopNavBar.URL_EXPORT_EVENT_NAME)
    );

    // Assert.
    // It should have a mapping for the event.
    expect(eventMap).toHaveProperty(ConnectedTopNavBar.URL_EXPORT_EVENT_NAME);

    // It should have used the correct action creator.
    expect(mockExportSelected).toBeCalledWith();
  });

  it(`fires the correct action creator for the ${ConnectedTopNavBar.URL_EXPORT_FINISHED_EVENT_NAME} event`, () => {
    // Arrange.
    const eventMap = navBarElement.mapEvents();

    // Act.
    eventMap[ConnectedTopNavBar.URL_EXPORT_FINISHED_EVENT_NAME](
      new CustomEvent<void>(ConnectedTopNavBar.URL_EXPORT_FINISHED_EVENT_NAME)
    );

    // Assert.
    // It should have a mapping for the event.
    expect(eventMap).toHaveProperty(
      ConnectedTopNavBar.URL_EXPORT_FINISHED_EVENT_NAME
    );

    // It should have used the correct action creator.
    expect(mockClearExportedImages).toBeCalledWith();
  });
});
