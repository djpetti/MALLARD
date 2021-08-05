import configureStore, { MockStoreCreator } from "redux-mock-store";
import thunk from "redux-thunk";
import {
  fakeObjectRef,
  fakeFrontendFileEntity,
  fakeState,
} from "./element-test-utils";
import uploadReducer, {
  closeDialog,
  dialogClosed,
  dialogOpened,
  fileDropZoneEntered,
  fileDropZoneExited,
  processSelectedFiles,
  thunkUploadFile,
  uploadSlice,
} from "../upload-slice";
import { FileStatus, RootState, UploadState } from "../types";

// Require syntax must be used here due to an issue that prevents
// access to faker.seed() when using import syntax.
const faker = require("faker");

// Using older require syntax here so we get the correct mock type.
const apiClient = require("../api-client");
const createImage: jest.Mock = apiClient.createImage;

// Mock out the gateway API.
jest.mock("../api-client", () => ({
  createImage: jest.fn(),
}));

// Mock out the JS fetch API.
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock out the `URL` API.
const mockCreateObjectUrl = jest.fn();
global.URL.createObjectURL = mockCreateObjectUrl;
const mockRevokeObjectUrl = jest.fn();
global.URL.revokeObjectURL = mockRevokeObjectUrl;

describe("upload-slice action creators", () => {
  /** Factory function for a mocked Redux store. */
  let mockStoreCreator: MockStoreCreator;

  beforeAll(() => {
    // Initialize the mock store factory.
    mockStoreCreator = configureStore([thunk]);
  });

  beforeEach(() => {
    // Set the faker seed.
    faker.seed(1337);
  });

  it("creates an uploadFile action", async () => {
    // Arrange.
    // Make it look like the create request succeeds.
    const newImageId = fakeObjectRef();
    createImage.mockResolvedValue(newImageId);

    // Initialize a fake store with valid state.
    const state = fakeState();
    state.uploads.dialogOpen = true;
    const uploadFile = fakeFrontendFileEntity();
    state.uploads.ids = [uploadFile.id];
    state.uploads.entities[uploadFile.id] = uploadFile;
    const store = mockStoreCreator(state);

    // Make it look like reading the image produces valid data.
    const mockResponse = { blob: jest.fn() };
    mockResponse.blob.mockResolvedValue(faker.datatype.string());
    mockFetch.mockResolvedValue(mockResponse);

    // Act.
    await thunkUploadFile(uploadFile.id)(store.dispatch, store.getState, {});

    // Assert.
    // It should have dispatched the lifecycle actions.
    const actions = store.getActions();
    expect(actions).toHaveLength(2);

    // Check the pending action.
    const pendingAction = actions[0];
    expect(pendingAction.type).toEqual("upload/uploadFiles/pending");

    // Check the fulfilled action.
    const fulfilledAction = actions[1];
    expect(fulfilledAction.type).toEqual("upload/uploadFiles/fulfilled");

    // It should have fetched the image.
    expect(mockFetch).toHaveBeenCalledWith(uploadFile.dataUrl);
    // It should have uploaded the image.
    expect(createImage).toHaveBeenCalledTimes(1);
  });

  it("creates a processSelectedFiles action", () => {
    // Arrange.
    // Create some files to process.
    const fakeFile = { type: "image/jpg", name: faker.system.fileName() };
    const dataTransferItem = { getAsFile: jest.fn() };
    // Create an invalid file as well.
    dataTransferItem.getAsFile
      .mockReturnValueOnce(fakeFile)
      .mockReturnValueOnce(fakeFile)
      .mockReturnValue(null);
    const dataTransferItemList = [
      dataTransferItem,
      dataTransferItem,
      dataTransferItem,
    ];

    // Make it look like creating the object URL succeeds.
    const imageUri = faker.image.dataUri();
    mockCreateObjectUrl.mockReturnValue(imageUri);

    // Act.
    // Fancy casting is so we can substitute mock objects.
    const gotAction = processSelectedFiles(
      dataTransferItemList as unknown as DataTransferItemList
    );

    // Assert.
    // It should have created the correct action.
    expect(gotAction.type).toEqual("upload/processSelectedFiles");
    expect(gotAction.payload).toHaveLength(2);
    expect(gotAction.payload[0].dataUrl).toEqual(imageUri);
    expect(gotAction.payload[1].dataUrl).toEqual(imageUri);
    expect(gotAction.payload[0].name).toEqual(fakeFile.name);
    expect(gotAction.payload[1].name).toEqual(fakeFile.name);
    expect(gotAction.payload[0].status).toEqual(FileStatus.PENDING);
    expect(gotAction.payload[1].status).toEqual(FileStatus.PENDING);
  });

  it("creates a dialogClosed action", () => {
    // Arrange.
    const state = fakeState();
    state.uploads.dialogOpen = true;
    // Make it look like we have some uploaded files.
    const uploadFile = fakeFrontendFileEntity();
    state.uploads.ids = [uploadFile.id];
    state.uploads.entities[uploadFile.id] = uploadFile;

    const store = mockStoreCreator(state);

    // Act.
    closeDialog()(store.dispatch, store.getState as () => RootState, {});

    // Assert.
    // It should have released the object URLs.
    expect(mockRevokeObjectUrl).toHaveBeenCalledWith(uploadFile.dataUrl);

    // It should have dispatched the action.
    const actions = store.getActions();
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toEqual(dialogClosed.type);
  });
});

describe("upload-slice reducers", () => {
  it("handles a dialogOpened action", () => {
    // Arrange.
    const state: UploadState = fakeState().uploads;
    state.dialogOpen = false;

    // Act.
    const newState = uploadSlice.reducer(state, dialogOpened(null));

    // Assert.
    // It should have set the dialog to opened.
    expect(newState.dialogOpen).toEqual(true);
  });

  it("handles a dialogClosed action", () => {
    // Arrange.
    const state: UploadState = fakeState().uploads;
    state.dialogOpen = true;
    // Make it look like we have some uploaded files.
    const uploadFile = fakeFrontendFileEntity();
    state.ids = [uploadFile.id];
    state.entities[uploadFile.id] = uploadFile;

    // Act.
    const newState = uploadSlice.reducer(state, dialogClosed(null));

    // Assert.
    // It should have set the dialog to opened.
    expect(newState.dialogOpen).toEqual(false);
    // It should have cleared any existing files.
    expect(newState.ids).toHaveLength(0);
  });

  it("handles a fileDropZoneEntered action", () => {
    // Arrange.
    const state: UploadState = fakeState().uploads;
    state.isDragging = false;

    // Act.
    const newState = uploadSlice.reducer(state, fileDropZoneEntered(null));

    // Assert.
    expect(newState.isDragging).toEqual(true);
  });

  it("handles a fileDropZoneExited action", () => {
    // Arrange.
    const state: UploadState = fakeState().uploads;
    state.isDragging = true;

    // Act.
    const newState = uploadSlice.reducer(state, fileDropZoneExited(null));

    // Assert.
    expect(newState.isDragging).toEqual(false);
  });

  it("handles an uploadFile/pending action", () => {
    // Arrange.
    const state: UploadState = fakeState().uploads;
    // Make it look like we have a pending file.
    const pendingFile = fakeFrontendFileEntity();
    pendingFile.status = FileStatus.PENDING;
    const doneFile = fakeFrontendFileEntity();
    doneFile.status = FileStatus.COMPLETE;
    state.ids = [pendingFile.id, doneFile.id];
    state.entities[pendingFile.id] = pendingFile;
    state.entities[doneFile.id] = doneFile;

    // Act.
    const newState = uploadReducer(state, {
      type: thunkUploadFile.typePrefix + "/pending",
      meta: { arg: pendingFile.id },
    });

    // Assert.
    // It should have modified the status of the pending file.
    expect(newState.entities[pendingFile.id]?.status).toEqual(
      FileStatus.PROCESSING
    );
    // It should not have changed the status of the complete file.
    expect(newState.entities[doneFile.id]?.status).toEqual(FileStatus.COMPLETE);
  });

  it("handles an uploadFile/fulfilled action", () => {
    // Arrange.
    const state: UploadState = fakeState().uploads;
    // Make it look like we have a processing file.
    const processingFile = fakeFrontendFileEntity();
    processingFile.status = FileStatus.PROCESSING;
    const doneFile = fakeFrontendFileEntity();
    doneFile.status = FileStatus.COMPLETE;
    state.ids = [processingFile.id, doneFile.id];
    state.entities[processingFile.id] = processingFile;
    state.entities[doneFile.id] = doneFile;

    // Act.
    const newState = uploadReducer(state, {
      type: thunkUploadFile.typePrefix + "/fulfilled",
      meta: { arg: processingFile.id },
    });

    // Assert.
    // It should have modified the status of the pending file.
    expect(newState.entities[processingFile.id]?.status).toEqual(
      FileStatus.COMPLETE
    );
    // It should not have changed the status of the complete file.
    expect(newState.entities[doneFile.id]?.status).toEqual(FileStatus.COMPLETE);
  });

  it("handles a processSelectedFiles action", () => {
    // Arrange.
    // Create some files to process.
    const file1 = fakeFrontendFileEntity();
    file1.status = FileStatus.PENDING;
    const file2 = fakeFrontendFileEntity();
    file2.status = FileStatus.PENDING;

    // Start with an empty state.
    const state: UploadState = fakeState().uploads;

    // Act.
    const newState = uploadReducer(state, {
      type: processSelectedFiles.type,
      payload: [file1, file2],
    });

    // Assert.
    // It should have added the files.
    expect(newState.ids).toHaveLength(2);
    expect(newState.ids).toContain(file1.id);
    expect(newState.ids).toContain(file2.id);

    // It should have marked the drag-and-drop action as finished.
    expect(newState.isDragging).toEqual(false);
  });
});
