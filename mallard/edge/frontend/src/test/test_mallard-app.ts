import { ConnectedMallardApp } from "../mallard-app";
import { Dialog } from "@material/mwc-dialog";
import each from "jest-each";
import { Fab } from "@material/mwc-fab";
import { Button } from "@material/mwc-button";
import { RootState } from "../types";
import { Action } from "redux";
import { fakeState, getShadowRoot } from "./element-test-utils";
import { dialogOpened, finishUpload } from "../upload-slice";

// I know this sounds insane, but when I import this as an ES6 module, faker.seed() comes up
// undefined. I can only assume this is a quirk in Babel.
const faker = require("faker");

jest.mock("@captaincodeman/redux-connect-element", () => ({
  // Turn connect() into a pass-through.
  connect: jest.fn((_, elementClass) => elementClass),
}));
jest.mock("../upload-slice", () => ({
  dialogOpened: jest.fn(),
  finishUpload: jest.fn(),
}));
jest.mock("../store", () => ({
  // Mock this to avoid an annoying spurious console error from Redux.
  configureStore: jest.fn(),
}));

const mockDialogOpened = dialogOpened as jest.MockedFn<typeof dialogOpened>;
const mockFinishUpload = finishUpload as jest.MockedFn<typeof finishUpload>;

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

  it("dispatches events when the modal is opened or closed", async () => {
    // Arrange.
    // Create a fake event handler.
    const eventHandler = jest.fn();
    app.addEventListener(
      ConnectedMallardApp.UPLOAD_MODAL_STATE_CHANGE,
      eventHandler
    );

    // Act.
    // Show the modal.
    app.uploadModalOpen = true;
    await app.updateComplete;
    // Hide the modal.
    app.uploadModalOpen = false;
    await app.updateComplete;

    // Assert.
    // It should have dispatched the event.
    expect(eventHandler).toBeCalledTimes(2);
    // The event should have indicated the new state of the modal.
    expect(eventHandler.mock.calls[0][0].detail).toBe(true);
    expect(eventHandler.mock.calls[1][0].detail).toBe(false);
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

  it("closes the modal when the done button is clicked", () => {
    // Arrange.
    // Get the add button.
    const shadowRoot = getShadowRoot(app.tagName);
    const doneButton = shadowRoot.querySelector("#done_button") as Button;

    // Act.
    // Simulate a button click.
    doneButton.dispatchEvent(new Event("click"));

    // Assert.
    // It should have closed the modal.
    expect(app.uploadModalOpen).toBe(false);
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

  it("updates the properties from the Redux state", () => {
    // Arrange.
    // Create a fake state.
    const state: RootState = fakeState();

    // Set the relevant parameters.
    const dialogOpen = faker.datatype.boolean();
    state.uploads.dialogOpen = dialogOpen;
    const uploadsInProgress = faker.datatype.number();
    state.uploads.uploadsInProgress = uploadsInProgress;

    // Act.
    const updates = app.mapState(state);

    // Assert.
    // It should have updated the modal state.
    expect(updates).toHaveProperty("uploadModalOpen");
    expect(updates["uploadModalOpen"]).toEqual(dialogOpen);
    expect(updates["uploadsInProgress"]).toEqual(uploadsInProgress > 0);
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
        ConnectedMallardApp.UPLOAD_MODAL_STATE_CHANGE
      );
    });

    each([
      ["close", false],
      ["open", true],
    ]).it(
      "uses the correct action creator for modal %s events",
      (_: string, modalOpen: boolean) => {
        // Arrange.
        const testEvent = {
          type: ConnectedMallardApp.UPLOAD_MODAL_STATE_CHANGE,
          detail: modalOpen,
        };

        // Act.
        eventMap[ConnectedMallardApp.UPLOAD_MODAL_STATE_CHANGE](
          testEvent as unknown as Event
        );

        // Assert.
        if (modalOpen) {
          expect(mockDialogOpened).toBeCalled();
        } else {
          expect(mockFinishUpload).toBeCalled();
        }
      }
    );
  });
});
