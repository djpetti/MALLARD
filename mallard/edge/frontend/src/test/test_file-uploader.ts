import { ConnectedFileUploader, FileUploader } from "../file-uploader";
import {
  fakeFrontendFileEntity,
  fakeState,
  getShadowRoot,
} from "./element-test-utils";
import { FileListDisplay } from "../file-list-display";
import { FileStatus, FrontendFileEntity, RootState } from "../types";
import each from "jest-each";
import { Action } from "redux";

// I know this sounds insane, but when I import this as an ES6 module, faker.seed() comes up
// undefined. I can only assume this is a quirk in Babel.
const faker = require("faker");

// Using older require syntax here so we get the correct mock type.
const uploadSlice = require("../upload-slice");
const mockDropZoneEntered = uploadSlice.fileDropZoneEntered;
const mockDropZoneExited = uploadSlice.fileDropZoneExited;
const mockProcessSelectedFiles = uploadSlice.processSelectedFiles;
const mockThunkUploadFile = uploadSlice.thunkUploadFile;
const mockThunkInferMetadata = uploadSlice.thunkInferMetadata;
const mockUploadSelectors = uploadSlice.uploadSelectors;
const { uploadSelectors } = jest.requireActual("../upload-slice");

jest.mock("@captaincodeman/redux-connect-element", () => ({
  // Turn connect() into a pass-through.
  connect: jest.fn((_, elementClass) => elementClass),
}));
jest.mock("../upload-slice", () => ({
  fileDropZoneEntered: jest.fn(),
  fileDropZoneExited: jest.fn(),
  processSelectedFiles: jest.fn(),
  thunkUploadFile: jest.fn(),
  thunkInferMetadata: jest.fn(),
  uploadSelectors: { selectAll: jest.fn() },
}));
jest.mock("../store", () => ({
  // Mock this to avoid an annoying spurious console error from Redux.
  configureStore: jest.fn(),
}));

describe("file-uploader", () => {
  /** Internal file-uploader to use for testing. */
  let fileUploader: ConnectedFileUploader;

  beforeAll(() => {
    // Manually register the custom element.
    customElements.define(ConnectedFileUploader.tagName, ConnectedFileUploader);
  });

  beforeEach(() => {
    // Set a faker seed.
    faker.seed(1337);

    // Use the actual implementation for this function.
    mockUploadSelectors.selectAll.mockImplementation(uploadSelectors.selectAll);

    // Create the element under test.
    fileUploader = window.document.createElement(
      ConnectedFileUploader.tagName
    ) as ConnectedFileUploader;
    document.body.appendChild(fileUploader);
  });

  afterEach(() => {
    // Clean up the testing element we created.
    document.body
      .getElementsByTagName(ConnectedFileUploader.tagName)[0]
      .remove();
  });

  it("can be instantiated", () => {
    // Assert.
    expect(fileUploader.uploadingFiles).toHaveLength(0);
  });

  it("can display some files", async () => {
    // Arrange.
    // Create some fake files to display.
    const file1 = fakeFrontendFileEntity();
    const file2 = fakeFrontendFileEntity();

    // Act.
    fileUploader.uploadingFiles = [file1, file2];
    await fileUploader.updateComplete;

    // Assert.
    const shadowRoot = getShadowRoot(fileUploader.tagName);
    const fileListDiv = shadowRoot.querySelector(".file_list");
    const fileList = fileListDiv?.querySelector("file-list") as FileListDisplay;

    // It should have updated the displayed files.
    expect(fileList.files).toEqual([file1, file2]);
  });

  each([
    [
      "some pending",
      [
        fakeFrontendFileEntity(FileStatus.PENDING),
        fakeFrontendFileEntity(FileStatus.PENDING),
        fakeFrontendFileEntity(FileStatus.PENDING),
        fakeFrontendFileEntity(FileStatus.PROCESSING),
        fakeFrontendFileEntity(FileStatus.COMPLETE),
      ],
      ConnectedFileUploader.MAX_CONCURRENT_UPLOADS - 1,
    ],
    [
      "none pending",
      [
        fakeFrontendFileEntity(FileStatus.COMPLETE),
        fakeFrontendFileEntity(FileStatus.PROCESSING),
      ],
      0,
    ],
    [
      "all pending",
      [
        fakeFrontendFileEntity(FileStatus.PENDING),
        fakeFrontendFileEntity(FileStatus.PENDING),
      ],
      2,
    ],
    [
      "max uploads reached",
      Array(FileUploader.MAX_CONCURRENT_UPLOADS).fill(
        fakeFrontendFileEntity(FileStatus.PROCESSING)
      ),
      0,
    ],
  ]).it(
    "dispatches events when a new uploadable file is found (%s)",
    async (
      _: string,
      files: FrontendFileEntity[],
      numExpectedEvents: number
    ) => {
      // Arrange.
      // Setup a fake handler for our event.
      const handler = jest.fn();
      fileUploader.addEventListener(
        ConnectedFileUploader.UPLOAD_READY_EVENT_NAME,
        handler
      );

      // Act.
      fileUploader.uploadingFiles = files;
      await fileUploader.updateComplete;

      // Assert.
      expect(handler).toBeCalledTimes(numExpectedEvents);
    }
  );

  it("dispatches an event when metadata can be inferred", async () => {
    // Arrange.
    // Setup a fake handler for our event.
    const handler = jest.fn();
    fileUploader.addEventListener(
      ConnectedFileUploader.METADATA_INFERENCE_READY_EVENT_NAME,
      handler
    );

    const fakeFile = fakeFrontendFileEntity();

    // Act.
    // Setting at least one file to upload should cause this event to get dispatched.
    fileUploader.uploadingFiles = [fakeFile];
    await fileUploader.updateComplete;

    // Assert.
    expect(handler).toBeCalledTimes(1);
  });

  each([
    ["valid", true, true],
    ["no", false, true],
    ["invalid", true, false],
  ]).it(
    "dispatches an event when %s files are dropped",
    async (_: string, validTransfer: boolean, validFiles: boolean) => {
      // Arrange.
      // Setup a fake handler for our event.
      const handler = jest.fn();
      fileUploader.addEventListener(
        ConnectedFileUploader.FILES_SELECTED_EVENT_NAME,
        handler
      );

      // Create a fake drag event. (We can't use a real one due to limitations in
      // JSDom).
      /** Since we don't have full access to the DragEvent type, we
       * have to kind of fake it. */
      class TestDragEvent extends Event {
        public dataTransfer?: any;
      }
      const dropEvent = new TestDragEvent("drop", {
        bubbles: true,
        composed: true,
      });

      // Create some fake transfer items.
      const fakeFile = validFiles ? "fakeFile" : null;
      const fakeItemMaker = () => ({ getAsFile: jest.fn(() => fakeFile) });
      const fakeItems = [fakeItemMaker(), fakeItemMaker()];
      if (validTransfer) {
        dropEvent.dataTransfer = { items: fakeItems };
      }

      // Act.
      // Make it look like we dropped files.
      const shadowRoot = getShadowRoot(fileUploader.tagName);
      const dropZone = shadowRoot.querySelector(
        "#upload_drop_zone"
      ) as HTMLElement;

      dropZone.dispatchEvent(dropEvent);

      await fileUploader.updateComplete;

      // Assert.
      // It should have dispatched a new event.
      expect(handler).toBeCalledTimes(1);
      if (validTransfer && validFiles) {
        // The event should contain files.
        expect(handler.mock.calls[0][0].detail).toHaveLength(2);
      } else {
        // The event should contain nothing.
        expect(handler.mock.calls[0][0].detail).toHaveLength(0);
      }
    }
  );

  each([
    ["dragging", true, "active_drag"],
    ["not dragging", false, "no_drag"],
  ]).it(
    "displays a visual cue when %s",
    async (_: string, isDragging: boolean, expectedClass: string) => {
      // Arrange.
      const shadowRoot = getShadowRoot(fileUploader.tagName);
      const dropZone = shadowRoot.querySelector(
        "#upload_drop_zone"
      ) as HTMLElement;

      // Act.
      // Fake a dragging event.
      if (isDragging) {
        dropZone.dispatchEvent(new Event("dragenter"));
      } else {
        dropZone.dispatchEvent(new Event("dragleave"));
      }
      await fileUploader.updateComplete;

      // Assert.
      // It should have chosen the correct class.
      expect(dropZone?.classList.value.split(" ")).toContain(expectedClass);
    }
  );

  it("forwards click events on the browse button to the file input", () => {
    // Arrange.
    // Get the elements.
    const shadowRoot = getShadowRoot(fileUploader.tagName);
    const browseButton = shadowRoot.querySelector("#browse") as HTMLElement;
    const uploadInput = shadowRoot.querySelector("#file_input") as HTMLElement;

    // Add a handler for the click event.
    const handler = jest.fn();
    uploadInput.addEventListener("click", handler);

    // Act.
    // Simulate the click event.
    browseButton.dispatchEvent(new Event("click"));

    // Assert.
    // It should have called the handler.
    expect(handler).toBeCalledTimes(1);
  });

  it("updates the properties from the Redux state", () => {
    // Arrange.
    // Create a fake state.
    const state: RootState = fakeState();

    // Make it look like we have things to upload.
    const uploadFile1 = fakeFrontendFileEntity();
    const uploadFile2 = fakeFrontendFileEntity();
    state.uploads.ids = [uploadFile1.id, uploadFile2.id];
    state.uploads.entities[uploadFile1.id] = uploadFile1;
    state.uploads.entities[uploadFile2.id] = uploadFile2;

    // Act.
    const updates = fileUploader.mapState(state);

    // Assert.
    // It should have gotten the correct updates.
    expect(updates).toHaveProperty("uploadingFiles");
    expect(updates.uploadingFiles).toContain(uploadFile1);
    expect(updates.uploadingFiles).toContain(uploadFile2);
  });

  describe("maps the correct actions to events", () => {
    // JSDom doesn't really know about drag-and-drop, so we create some mocks.
    interface FakeDataTransfer {
      items: any[];
    }

    interface FakeDragEvent {
      type: string;
      dataTransfer?: FakeDataTransfer;
      detail?: any;
      preventDefault?: () => {};
    }

    /** Map of events to action creators. */
    let eventMap: { [p: string]: (event: Event) => Action };

    beforeEach(() => {
      // Act.
      eventMap = fileUploader.mapEvents();

      // Assert.
      // It should have a mapping for the proper events.
      expect(eventMap).toHaveProperty(
        FileUploader.DROP_ZONE_DRAGGING_EVENT_NAME
      );
      expect(eventMap).toHaveProperty(FileUploader.FILES_SELECTED_EVENT_NAME);
      expect(eventMap).toHaveProperty(FileUploader.UPLOAD_READY_EVENT_NAME);
      expect(eventMap).toHaveProperty(
        FileUploader.METADATA_INFERENCE_READY_EVENT_NAME
      );
    });

    it("uses the correct action creator for drop-zone-dragging entry events", () => {
      // Arrange.
      const testEvent: FakeDragEvent = {
        type: FileUploader.DROP_ZONE_DRAGGING_EVENT_NAME,
        detail: true,
      };

      // Act.
      eventMap[FileUploader.DROP_ZONE_DRAGGING_EVENT_NAME](
        testEvent as unknown as Event
      );

      // Assert.
      expect(mockDropZoneEntered).toBeCalledTimes(1);
      expect(mockDropZoneEntered).toBeCalledWith(null);
    });

    it("uses the correct action creator for drop-zone-dragging exit events", () => {
      // Arrange.
      const testEvent = {
        type: FileUploader.DROP_ZONE_DRAGGING_EVENT_NAME,
        detail: false,
      };

      // Act.
      eventMap[FileUploader.DROP_ZONE_DRAGGING_EVENT_NAME](
        testEvent as unknown as Event
      );

      // Assert.
      expect(mockDropZoneExited).toBeCalledTimes(1);
      expect(mockDropZoneExited).toBeCalledWith(null);
    });

    it("uses the correct action creator for drop events", () => {
      // Arrange.
      const testEvent = {
        type: "drop",
        detail: ["foo", "bar"],
        preventDefault: jest.fn(),
      };

      // Act.
      eventMap[FileUploader.FILES_SELECTED_EVENT_NAME](
        testEvent as unknown as Event
      );

      // Assert.
      expect(mockProcessSelectedFiles).toBeCalledTimes(1);
      expect(mockProcessSelectedFiles).toBeCalledWith(testEvent.detail);
    });

    // TODO (danielp) Re-enable once JSDom supports drag-and-drop.
    // it("handles a drop event when there are no new uploads", () => {
    //   // Arrange.
    //   const testEvent = {
    //     type: "drop",
    //     detail: null,
    //     preventDefault: jest.fn(),
    //   };
    //
    //   // Act.
    //   eventMap["drop"](testEvent as unknown as Event);
    //
    //   // Assert.
    //   expect(mockProcessSelectedFiles).toBeCalledTimes(1);
    // });

    it("uses the correct action creator for upload-ready events", () => {
      // Arrange.
      const fileId = faker.datatype.uuid();
      const testEvent = {
        type: FileUploader.UPLOAD_READY_EVENT_NAME,
        detail: fileId,
      };

      // Act.
      eventMap[FileUploader.UPLOAD_READY_EVENT_NAME](
        testEvent as unknown as Event
      );

      // Assert.
      expect(mockThunkUploadFile).toBeCalledTimes(1);
      expect(mockThunkUploadFile).toBeCalledWith(fileId);
    });

    it("uses the correct action creator for meta-inference-ready events", () => {
      // Arrange.
      const fileId = faker.datatype.uuid();
      const testEvent = {
        type: FileUploader.METADATA_INFERENCE_READY_EVENT_NAME,
        detail: fileId,
      };

      // Act.
      eventMap[FileUploader.METADATA_INFERENCE_READY_EVENT_NAME](
        testEvent as unknown as Event
      );

      // Assert.
      expect(mockThunkInferMetadata).toBeCalledTimes(1);
      expect(mockThunkInferMetadata).toBeCalledWith(fileId);
    });
  });
});