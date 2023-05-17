import { ConnectedMallardApp } from "../mallard-app";
import { Dialog } from "@material/mwc-dialog";
import each from "jest-each";
import { Fab } from "@material/mwc-fab";
import { Button } from "@material/mwc-button";
import { RootState, UploadWorkflowStatus } from "../types";
import { Action } from "redux";
import { fakeState, getShadowRoot } from "./element-test-utils";
import { dialogOpened, thunkFinishUpload } from "../upload-slice";
import { faker } from "@faker-js/faker";
import { ThumbnailGrid } from "../thumbnail-grid";

jest.mock("@captaincodeman/redux-connect-element", () => ({
  // Turn connect() into a pass-through.
  connect: jest.fn((_, elementClass) => elementClass),
}));
jest.mock("../upload-slice", () => ({
  dialogOpened: jest.fn(),
  thunkFinishUpload: jest.fn(),
}));
jest.mock("../store", () => ({
  // Mock this to avoid an annoying spurious console error from Redux.
  configureStore: jest.fn(),
}));

const mockDialogOpened = dialogOpened as jest.MockedFn<typeof dialogOpened>;
const mockFinishUpload = thunkFinishUpload as jest.MockedFn<
  typeof thunkFinishUpload
>;

describe("mallard-app", () => {
  /** Internal MallardApp to use for testing. */
  let app: ConnectedMallardApp;

  beforeAll(() => {
    // Manually register the custom element.
    customElements.define(ConnectedMallardApp.tagName, ConnectedMallardApp);
  });

  beforeEach(async () => {
    // Set a faker seed.
    faker.seed(1337);

    // Reset mocks.
    jest.clearAllMocks();

    // Create the element under test.
    app = window.document.createElement(
      ConnectedMallardApp.tagName
    ) as ConnectedMallardApp;
    document.body.appendChild(app);
    await app.updateComplete;
  });

  afterEach(() => {
    // Clean up the element we created.
    document.body.getElementsByTagName(ConnectedMallardApp.tagName)[0].remove();
  });

  it("can be instantiated", () => {
    // Assert.
    expect(app.uploadModalOpen).toBe(false);
  });

  each([
    ["closed", false],
    ["open", true],
  ]).it(
    "properly renders with the upload modal %s",
    async (_: string, modalOpen: boolean) => {
      // Act.
      app.uploadModalOpen = modalOpen;
      await app.updateComplete;

      // Assert.
      const shadowRoot = getShadowRoot(app.tagName);
      const uploadModal = shadowRoot.querySelector("#upload_modal") as Dialog;
      // The modal should be in the correct state.
      expect(uploadModal.open).toBe(modalOpen);
    }
  );

  it("dispatches an event when the modal is opened", async () => {
    // Arrange.
    // Create a fake event handler.
    const eventHandler = jest.fn();
    app.addEventListener(
      ConnectedMallardApp.UPLOAD_MODAL_OPEN_EVENT_NAME,
      eventHandler
    );

    // Act.
    // Show the modal.
    app.uploadModalOpen = true;
    await app.updateComplete;

    // Assert.
    // It should have dispatched the event.
    expect(eventHandler).toBeCalledTimes(1);
  });

  it("updates the image view when the upload modal is closed", async () => {
    // Assert.
    // Mock out the grid update.
    const root = getShadowRoot(ConnectedMallardApp.tagName);
    const grid = root.querySelector("thumbnail-grid") as ThumbnailGrid;
    Object.assign(grid, { loadContentWhileNeeded: jest.fn() });

    // Act.
    // Show the modal.
    app.uploadModalOpen = true;
    await app.updateComplete;
    // Hide the modal.
    app.uploadModalOpen = false;
    await app.updateComplete;

    // Assert.
    // It should have updated the grid.
    expect(grid.loadContentWhileNeeded).toBeCalledTimes(1);
  });

  it("opens the modal when the add button is clicked", () => {
    // Arrange.
    // Get the add button.
    const shadowRoot = getShadowRoot(app.tagName);
    const addButton = shadowRoot.querySelector("#add_data") as Fab;

    // Act.
    // Simulate a button click.
    addButton.dispatchEvent(new Event("click"));

    // Assert.
    // It should have opened the modal.
    expect(app.uploadModalOpen).toBe(true);
  });

  it("dispatches an event when the done button is clicked", () => {
    // Arrange.
    // Get the add button.
    const shadowRoot = getShadowRoot(app.tagName);
    const doneButton = shadowRoot.querySelector("#done_button") as Button;

    // Create a fake event handler.
    const eventHandler = jest.fn();
    app.addEventListener(
      ConnectedMallardApp.DONE_BUTTON_EVENT_NAME,
      eventHandler
    );

    // Act.
    // Simulate a button click.
    doneButton.dispatchEvent(new Event("click"));

    // Assert.
    // It should have dispatched the event.
    expect(eventHandler).toBeCalledTimes(1);
  });

  it("does not allow the upload modal to be closed while uploading", async () => {
    // Act.
    // Make it look like some uploads are in-progress.
    app.uploadsInProgress = true;
    await app.updateComplete;

    // Assert.
    // It should disable the close button on the modal.
    const root = getShadowRoot(app.tagName);
    const doneButton = root.querySelector("#done_button") as Button;
    expect(doneButton.disabled).toEqual(true);
  });

  it("shows a spinner while finalizing the upload", async () => {
    // Arrange.
    // Make it look like uploads are being finalized.
    app.finalizingUploads = true;

    // Act.
    await app.updateComplete;

    // Assert.
    // It should show a spinner instead of a close button.
    const root = getShadowRoot(app.tagName);

    // It should not be showing the "Done" button.
    const doneButton = root.querySelector("#done_button");
    expect(doneButton).toBeNull();

    // It should be showing a spinner instead.
    const spinner = root.querySelector("mwc-circular-progress");
    expect(spinner).not.toBeNull();
  });

  it("updates the properties from the Redux state", () => {
    // Arrange.
    // Create a fake state.
    const state: RootState = fakeState();

    // Set the relevant parameters.
    const dialogOpen = faker.datatype.boolean();
    state.uploads.dialogOpen = dialogOpen;
    const uploadsInProgress = faker.datatype.number();
    state.uploads.uploadsInProgress = uploadsInProgress;
    const uploadStatus = faker.helpers.arrayElement([
      UploadWorkflowStatus.WAITING,
      UploadWorkflowStatus.UPLOADING,
      UploadWorkflowStatus.FINALIZING,
    ]);
    state.uploads.status = uploadStatus;

    // Act.
    const updates = app.mapState(state);

    // Assert.
    // It should have updated the modal state.
    expect(updates).toHaveProperty("uploadModalOpen");
    expect(updates["uploadModalOpen"]).toEqual(dialogOpen);
    expect(updates["uploadsInProgress"]).toEqual(uploadsInProgress > 0);
    expect(updates["finalizingUploads"]).toEqual(
      uploadStatus === UploadWorkflowStatus.FINALIZING
    );
  });

  describe("maps the correct actions to events", () => {
    /** Map of events to action creators. */
    let eventMap: { [p: string]: (event: Event) => Action };

    beforeEach(() => {
      // Act.
      eventMap = app.mapEvents();

      // Assert.
      // It should have a mapping for the proper events.
      expect(eventMap).toHaveProperty(
        ConnectedMallardApp.UPLOAD_MODAL_OPEN_EVENT_NAME
      );
    });

    it(`handles ${ConnectedMallardApp.UPLOAD_MODAL_OPEN_EVENT_NAME} events`, () => {
      // Arrange.
      const testEvent = new CustomEvent(
        ConnectedMallardApp.UPLOAD_MODAL_OPEN_EVENT_NAME
      );

      // Act.
      eventMap[ConnectedMallardApp.UPLOAD_MODAL_OPEN_EVENT_NAME](testEvent);

      // Assert.
      expect(mockDialogOpened).toBeCalled();
    });

    it(`handles ${ConnectedMallardApp.DONE_BUTTON_EVENT_NAME} events`, () => {
      // Arrange.
      const testEvent = new CustomEvent(
        ConnectedMallardApp.DONE_BUTTON_EVENT_NAME
      );

      // Act.
      eventMap[ConnectedMallardApp.DONE_BUTTON_EVENT_NAME](testEvent);

      // Assert.
      expect(mockFinishUpload).toBeCalled();
    });
  });
});
