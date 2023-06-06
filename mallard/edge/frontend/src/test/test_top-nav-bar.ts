import { ConnectedTopNavBar, TopNavBar } from "../top-nav-bar";
import {
  fakeImageMetadata,
  fakeState,
  getShadowRoot,
} from "./element-test-utils";
import each from "jest-each";
import { TopAppBarFixed } from "@material/mwc-top-app-bar-fixed";
import { IconButton } from "@material/mwc-icon-button";
import {
  setEditingDialogOpen,
  thunkBulkDownloadSelected,
  thunkClearExportedImages,
  thunkDeleteSelected,
  thunkExportSelected,
  thunkSelectAll,
  thunkUpdateSelectedMetadata,
} from "../thumbnail-grid-slice";
import { Dialog } from "@material/mwc-dialog";
import { Button } from "@material/mwc-button";
import { RequestState } from "../types";
import { Menu } from "@material/mwc-menu";
import { ListItem } from "@material/mwc-list/mwc-list-item";
import { faker } from "@faker-js/faker";
import { ConnectedMetadataEditingForm } from "../metadata-form";
import { UavImageMetadata } from "mallard-api";

// Create the mocks.
jest.mock("../thumbnail-grid-slice", () => {
  const actualSlice = jest.requireActual("../thumbnail-grid-slice");
  return {
    thunkBulkDownloadSelected: jest.fn(),
    thunkDeleteSelected: jest.fn(),
    thunkSelectAll: jest.fn(),
    thunkExportSelected: jest.fn(),
    thunkClearExportedImages: jest.fn(),
    thunkUpdateSelectedMetadata: jest.fn(),

    setEditingDialogOpen: jest.fn(),

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
const mockUpdateSelectedMetadata = thunkUpdateSelectedMetadata as jest.MockedFn<
  typeof thunkUpdateSelectedMetadata
>;
const mockSetEditingDialogOpen = setEditingDialogOpen as jest.MockedFn<
  typeof setEditingDialogOpen
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

    // It should have rendered the deletion dialog, but not opened it.
    const deleteConfirmDialog = root.querySelector("#confirm_delete_dialog");
    expect(deleteConfirmDialog).not.toBeNull();
    expect((deleteConfirmDialog as Dialog).open).toEqual(false);

    // It should not have rendered the editing dialog.
    expect(root.querySelector("#edit_metadata_dialog")).toBeNull();

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

  it("renders when showing the metadata editing dialog", async () => {
    // Arrange.
    // Show the editing dialog.
    navBarElement.showEditingDialog = true;

    // Act.
    await navBarElement.updateComplete;

    // Assert.
    const root = getShadowRoot(ConnectedTopNavBar.tagName);
    const topBar = root.querySelector("#app_bar");
    expect(topBar).not.toBe(null);

    // It should have rendered the dialog.
    const editMetadataDialog = root.querySelector("#edit_metadata_dialog");
    expect(editMetadataDialog).not.toBeNull();

    // The dialog should be open.
    expect((editMetadataDialog as Dialog).open).toEqual(true);

    // The dialog should contain the metadata editing form.
    const metadataForm = root.querySelector("#metadata_form");
    expect(metadataForm).not.toBeNull();
  });

  it("renders when showing the editing progress indicator", async () => {
    // Arrange.
    // Show the editing progress indicator.
    navBarElement.showEditingDialog = true;
    navBarElement.showEditingProgress = true;

    // Act.
    await navBarElement.updateComplete;

    // Assert.
    const root = getShadowRoot(ConnectedTopNavBar.tagName);
    const topBar = root.querySelector("#app_bar");
    expect(topBar).not.toBe(null);

    // It should have rendered the dialog.
    const editMetadataDialog = root.querySelector("#edit_metadata_dialog");
    expect(editMetadataDialog).not.toBeNull();

    // Only the cancel button should be visible and disabled.
    const buttons = editMetadataDialog?.querySelectorAll(
      "mwc-button"
    ) as NodeListOf<Button>;
    expect(buttons).toHaveLength(1);
    expect(buttons[0].disabled).toEqual(true);

    // The confirm button should have been replaced by a loading indicator.
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

  it("dispatches an event when the edit button is clicked", async () => {
    // Arrange.
    // Make it look like items are selected.
    navBarElement.numItemsSelected = 3;
    await navBarElement.updateComplete;

    // Add a handler for the event.
    const editHandler = jest.fn();
    navBarElement.addEventListener(
      ConnectedTopNavBar.EDIT_METADATA_EVENT_NAME,
      editHandler
    );

    // Act.
    // Simulate a click on the edit button.
    const root = getShadowRoot(ConnectedTopNavBar.tagName);
    const topBar = root.querySelector("#app_bar") as TopAppBarFixed;
    const editButton = topBar.querySelector("#edit_button") as IconButton;

    editButton.dispatchEvent(new MouseEvent("click"));

    // Assert.
    // It should have fired the event.
    expect(editHandler).toBeCalledTimes(1);
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

  it("dispatches an event when the edit dialog confirmation button is clicked", async () => {
    // Arrange.
    // Make it show the dialog.
    navBarElement.showEditingDialog = true;
    await navBarElement.updateComplete;

    // Set the metadata object on the component.
    const root = getShadowRoot(ConnectedTopNavBar.tagName);
    const metadataForm = root.querySelector(
      "#metadata_form"
    ) as ConnectedMetadataEditingForm;
    const mockMetadata = fakeImageMetadata();
    metadataForm.metadata = mockMetadata;

    // Add a handler for the event.
    const metadataEditedHandler = jest.fn();
    navBarElement.addEventListener(
      ConnectedTopNavBar.METADATA_EDITED_EVENT_NAME,
      metadataEditedHandler
    );

    // Act.
    // Simulate a click on the edit dialog confirmation button.
    const editConfirmButton = root.querySelector(
      "#edit_confirm_button"
    ) as Button;
    expect(editConfirmButton).not.toBeNull();

    editConfirmButton.dispatchEvent(new MouseEvent("click"));

    await navBarElement.updateComplete;

    // Assert.
    // It should have fired the event with the correct metadata.
    expect(metadataEditedHandler).toBeCalledTimes(1);
    expect(metadataEditedHandler).toBeCalledWith(
      expect.objectContaining({
        detail: mockMetadata,
      })
    );
  });

  it("dispatches an event when the edit dialog cancel button is clicked", async () => {
    // Arrange.
    // Make it show the dialog.
    navBarElement.showEditingDialog = true;
    await navBarElement.updateComplete;

    // Add a handler for the event.
    const metadataEditingCancelledHandler = jest.fn();
    navBarElement.addEventListener(
      ConnectedTopNavBar.METADATA_EDITING_CANCELLED_EVENT_NAME,
      metadataEditingCancelledHandler
    );

    // Act.
    // Simulate a click on the edit dialog cancel button.
    const root = getShadowRoot(ConnectedTopNavBar.tagName);
    const cancelEditingButton = root.querySelector(
      "#edit_cancel_button"
    ) as Button;
    expect(cancelEditingButton).not.toBeNull();

    cancelEditingButton.dispatchEvent(new MouseEvent("click"));

    await navBarElement.updateComplete;

    // Assert.
    // It should have fired the event.
    expect(metadataEditingCancelledHandler).toBeCalledTimes(1);
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

  it(`fires the correct action creator for the ${ConnectedTopNavBar.EDIT_METADATA_EVENT_NAME} event`, () => {
    // Arrange.
    const eventMap = navBarElement.mapEvents();

    // Act.
    eventMap[ConnectedTopNavBar.EDIT_METADATA_EVENT_NAME](
      new CustomEvent<void>(ConnectedTopNavBar.EDIT_METADATA_EVENT_NAME)
    );

    // Assert.
    // It should have a mapping for the event.
    expect(eventMap).toHaveProperty(
      ConnectedTopNavBar.EDIT_METADATA_EVENT_NAME
    );

    // It should have used the correct action creator.
    expect(mockSetEditingDialogOpen).toBeCalledWith(true);
  });

  it(`fires the correct action creator for the ${ConnectedTopNavBar.METADATA_EDITED_EVENT_NAME} event`, () => {
    // Arrange.
    const eventMap = navBarElement.mapEvents();

    const metadata = fakeImageMetadata();

    // Act.
    eventMap[ConnectedTopNavBar.METADATA_EDITED_EVENT_NAME](
      new CustomEvent<UavImageMetadata>(
        ConnectedTopNavBar.METADATA_EDITED_EVENT_NAME,
        { detail: metadata }
      )
    );

    // Assert.
    // It should have a mapping for the event.
    expect(eventMap).toHaveProperty(
      ConnectedTopNavBar.METADATA_EDITED_EVENT_NAME
    );

    // It should have used the correct action creator.
    expect(mockUpdateSelectedMetadata).toBeCalledWith(metadata);
  });

  it(`fires the correct action creator for the ${ConnectedTopNavBar.METADATA_EDITING_CANCELLED_EVENT_NAME} event`, () => {
    // Arrange.
    const eventMap = navBarElement.mapEvents();

    // Act.
    eventMap[ConnectedTopNavBar.METADATA_EDITING_CANCELLED_EVENT_NAME](
      new CustomEvent<void>(
        ConnectedTopNavBar.METADATA_EDITING_CANCELLED_EVENT_NAME
      )
    );

    // Assert.
    // It should have a mapping for the event.
    expect(eventMap).toHaveProperty(
      ConnectedTopNavBar.METADATA_EDITING_CANCELLED_EVENT_NAME
    );

    // It should have used the correct action creator.
    expect(mockSetEditingDialogOpen).toBeCalledWith(false);
  });
});
