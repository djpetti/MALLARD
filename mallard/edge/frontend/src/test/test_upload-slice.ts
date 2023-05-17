import configureStore, { MockStore, MockStoreCreator } from "redux-mock-store";
import thunk from "redux-thunk";
import {
  fakeFrontendFileEntity,
  fakeImageMetadata,
  fakeObjectRef,
  fakeFile,
  fakeState,
} from "./element-test-utils";
import uploadReducer, {
  thunkFinishUpload,
  dialogClosed,
  dialogOpened,
  fileDropZoneEntered,
  fileDropZoneExited,
  setMetadata,
  thunkInferMetadata,
  thunkUploadFile,
  uploadSlice,
  addSelectedFiles,
  thunkPreProcessFiles,
} from "../upload-slice";
import {
  FileStatus,
  FrontendFileEntity,
  MetadataInferenceStatus,
  RootState,
  UploadState,
  UploadWorkflowStatus,
} from "../types";
import { AsyncThunk } from "@reduxjs/toolkit";
import each from "jest-each";
import { thunkClearImageView } from "../thumbnail-grid-slice";
import imageBlobReduce, {
  ImageBlobReduce,
  ImageBlobReduceStatic,
} from "image-blob-reduce";
import { faker } from "@faker-js/faker";
import { UavImageMetadata } from "mallard-api";
import { cloneDeep } from "lodash";

// Using older require syntax here so we get the correct mock type.
const apiClient = require("../api-client");
const mockCreateImage: jest.Mock = apiClient.createImage;
const mockInferMetadata: jest.Mock = apiClient.inferMetadata;
const mockUpdateMetadata: jest.Mock = apiClient.batchUpdateMetadata;

// Mock out the thumbnailGridSlice.
jest.mock("../thumbnail-grid-slice", () => ({
  thunkClearImageView: jest.fn(),
}));
const mockClearImageView = thunkClearImageView as jest.MockedFn<
  typeof thunkClearImageView
>;

// Mock out the gateway API.
jest.mock("../api-client", () => ({
  createImage: jest.fn(),
  inferMetadata: jest.fn(),
  batchUpdateMetadata: jest.fn(),
}));

// Mock out image-blob-reduce.
jest.mock("image-blob-reduce");
const mockImageBlobReduce =
  imageBlobReduce as jest.MockedClass<ImageBlobReduceStatic>;

// Mock out the `URL` API.
const mockCreateObjectUrl = jest.fn();
global.URL.createObjectURL = mockCreateObjectUrl;
const mockRevokeObjectUrl = jest.fn();
global.URL.revokeObjectURL = mockRevokeObjectUrl;

describe("upload-slice action creators", () => {
  /** Factory function for a mocked Redux store. */
  let mockStoreCreator: MockStoreCreator;
  /** Stores the mocked global instance of imageBlobReduce. */
  let mockImageBlobReduceInstance: jest.MockedObject<ImageBlobReduce>;

  beforeAll(() => {
    // Initialize the mock store factory.
    mockStoreCreator = configureStore([thunk]);

    // When we reset the mocks, it will destroy the record of any
    // global instances of mocked classes that we created, so save
    // them here.
    mockImageBlobReduceInstance = mockImageBlobReduce.mock
      .instances[0] as jest.MockedObject<ImageBlobReduce>;
  });

  beforeEach(() => {
    // Set the faker seed.
    faker.seed(1337);

    // Reset the mocks.
    jest.clearAllMocks();
  });

  describe("async thunks", () => {
    /** A fake state to use for testing. */
    let state: RootState;
    /** A fake upload file to use for testing. */
    let uploadFile: FrontendFileEntity;
    /** A fake set of uploaded files for testing. */
    let idsToFiles: Map<string, File>;
    /** A fake Redux store to use for testing. */
    let store: MockStore;

    beforeEach(() => {
      // Initialize a fake store with valid state.
      state = fakeState();
      state.uploads.dialogOpen = true;

      // The state should have a single pending file.
      uploadFile = fakeFrontendFileEntity();
      idsToFiles = new Map([[uploadFile.id, fakeFile()]]);

      state.uploads.ids = [uploadFile.id];
      state.uploads.entities[uploadFile.id] = uploadFile;
      store = mockStoreCreator(state);
    });

    /**
     * @brief Checks that an `AsyncThunk` has dispatched the lifecycle actions.
     * @param {AsyncThunk} thunk The thunk to check.
     */
    function checkDispatchedActions(thunk: AsyncThunk<any, any, any>): void {
      const actions = store.getActions();
      expect(actions).toHaveLength(2);

      // Check the pending action.
      const pendingAction = actions[0];
      expect(pendingAction.type).toEqual(`${thunk.typePrefix}/pending`);

      // Check the fulfilled action.
      const fulfilledAction = actions[1];
      expect(fulfilledAction.type).toEqual(`${thunk.typePrefix}/fulfilled`);
    }

    it("creates an uploadFile action", async () => {
      // Arrange.
      // Make it look like the create request succeeds.
      const newImageId = fakeObjectRef();
      mockCreateImage.mockResolvedValue(newImageId);

      // Act.
      await thunkUploadFile({ fileId: uploadFile.id, idsToFiles: idsToFiles })(
        store.dispatch,
        store.getState,
        {}
      );

      // Assert.
      // It should have dispatched the lifecycle actions.
      checkDispatchedActions(thunkUploadFile);

      // It should have uploaded the image.
      const fakeFile = idsToFiles.get(uploadFile.id) as File;
      expect(mockCreateImage).toHaveBeenCalledTimes(1);
      expect(mockCreateImage).toBeCalledWith(fakeFile, {
        name: fakeFile.name,
        metadata: {},
      });
    });

    it("creates an inferMetadata action", async () => {
      // Arrange.
      // Inference must not have been started yet for this to succeed.
      state.uploads.metadataStatus = MetadataInferenceStatus.NOT_STARTED;

      // Make it look like the inference request succeeds.
      const metadata = fakeImageMetadata();
      mockInferMetadata.mockResolvedValue(metadata);

      // Act.
      await thunkInferMetadata({
        fileId: uploadFile.id,
        idsToFiles: idsToFiles,
      })(store.dispatch, store.getState, {});

      // Assert.
      // It should have dispatched the lifecycle actions.
      checkDispatchedActions(thunkInferMetadata);

      // It should have inferred the metadata.
      const fakeFile = idsToFiles.get(uploadFile.id);
      expect(mockInferMetadata).toHaveBeenCalledWith(
        fakeFile,
        expect.anything()
      );
    });

    it("does not dispatch inferMetadata if inference is in-progress", async () => {
      // Arrange.
      // Make it look like inference has started already.
      state.uploads.metadataStatus = MetadataInferenceStatus.LOADING;

      // Act.
      await thunkInferMetadata({
        fileId: uploadFile.id,
        idsToFiles: idsToFiles,
      })(store.dispatch, store.getState, {});

      // Assert.
      // It should not have dispatched any actions.
      expect(store.getActions()).toHaveLength(0);
    });

    it("creates a preProcessFiles action", async () => {
      // Arrange.
      const fileIds = state.uploads.ids as string[];

      // Make it look like it produces a valid thumbnail blob.
      const mockToBlob = mockImageBlobReduceInstance.toBlob;
      const thumbnailBlob = fakeFile();
      mockToBlob.mockResolvedValue(thumbnailBlob);

      // Create a fake thumbnail URL.
      const thumbnailUrl = faker.internet.url();
      mockCreateObjectUrl.mockReturnValue(thumbnailUrl);

      // Act.
      await thunkPreProcessFiles({ fileIds, idsToFiles })(
        store.dispatch,
        store.getState,
        {}
      );

      // Assert.
      // It should have dispatched the lifecycle actions.
      checkDispatchedActions(thunkPreProcessFiles);

      // It should have created thumbnails for the images.
      expect(mockToBlob).toHaveBeenCalledTimes(1);
      const fakeFileData = idsToFiles.get(uploadFile.id) as File;
      expect(mockToBlob).toHaveBeenCalledWith(fakeFileData, expect.anything());

      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
      expect(URL.createObjectURL).toHaveBeenCalledWith(thumbnailBlob);

      // It should have returned the correct results.
      expect(store.getActions()[1].payload).toEqual([
        {
          id: uploadFile.id,
          dataUrl: thumbnailUrl,
        },
      ]);
    });

    each([
      ["changed metadata", true, fakeImageMetadata()],
      ["unchanged metadata", false, fakeImageMetadata()],
      ["no metadata", true, null],
    ]).it(
      "finalizes the upload with %s",
      async (
        _: string,
        hasNewMetadata: boolean,
        metadata: UavImageMetadata | null
      ) => {
        // Arrange.
        const state = fakeState();
        state.uploads.dialogOpen = true;
        // Make it look like we have some uploaded files.
        const uploadFile = fakeFrontendFileEntity();
        state.uploads.ids = [uploadFile.id];
        state.uploads.entities[uploadFile.id] = uploadFile;
        state.uploads.metadataChanged = hasNewMetadata;
        state.uploads.metadata = metadata;

        const store = mockStoreCreator(state);

        // Use a dummy action here to simulate how this thunk works.
        mockClearImageView.mockReturnValue((dispatch) => {
          dispatch({ type: "thunkClearImageView", payload: undefined });
        });

        // Act.
        await thunkFinishUpload()(
          store.dispatch,
          store.getState as () => RootState,
          {}
        );

        // Assert.
        if (hasNewMetadata) {
          // It should have updated the metadata on the backend.
          if (metadata !== null) {
            // It should not have sent the metadata name.
            const expectedMetadata = cloneDeep(state.uploads.metadata);
            (expectedMetadata as UavImageMetadata).name = undefined;
            // It should have performed the request.
            expect(mockUpdateMetadata).toHaveBeenCalledWith(expectedMetadata, [
              uploadFile.backendRef,
            ]);
          } else {
            // It should have just used the empty metadata.
            expect(mockUpdateMetadata).toHaveBeenCalledWith(null, [
              uploadFile.backendRef,
            ]);
          }
        }

        // It should have released the object URLs.
        expect(mockRevokeObjectUrl).toHaveBeenCalledWith(
          uploadFile.thumbnailUrl
        );

        // It should have dispatched the action.
        const actions = store.getActions();
        expect(actions).toHaveLength(4);
        // It should dispatch the pending action before anything.
        expect(actions[0].type).toEqual(thunkFinishUpload.pending.type);
        expect(actions[1].type).toEqual(dialogClosed.type);
        expect(actions[2].type).toEqual("thunkClearImageView");
        expect(actions[3].type).toEqual(thunkFinishUpload.fulfilled.type);
      }
    );
  });

  it("creates an addSelectedFiles action", () => {
    // Arrange.
    // Create some files to process.
    const fakeImageFile = fakeFile();
    const fakeTextFile = fakeFile("text/plain");
    const id1 = faker.datatype.uuid();
    const id2 = faker.datatype.uuid();
    const fileMap = new Map([
      [id1, fakeImageFile],
      [id2, fakeImageFile],
      // Throw one invalid file in there too.
      [faker.datatype.uuid(), fakeTextFile],
    ]);

    // Act.
    // Fancy casting is so we can substitute mock objects.
    const gotAction = addSelectedFiles(fileMap);

    // Assert.
    // It should have created the correct action.
    expect(gotAction.type).toEqual("upload/addSelectedFiles");
    expect(gotAction.payload).toHaveLength(2);
    expect(gotAction.payload[0].id).toEqual(id1);
    expect(gotAction.payload[1].id).toEqual(id2);
    expect(gotAction.payload[0].name).toEqual(fakeImageFile.name);
    expect(gotAction.payload[1].name).toEqual(fakeImageFile.name);
    expect(gotAction.payload[0].status).toEqual(FileStatus.PENDING);
    expect(gotAction.payload[1].status).toEqual(FileStatus.PENDING);
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

  it("handles a setMetadata action", () => {
    // Arrange.
    const state: UploadState = fakeState().uploads;
    state.metadata = null;
    state.metadataChanged = false;

    const newMetadata = fakeImageMetadata();

    // Act.
    const newState = uploadSlice.reducer(state, setMetadata(newMetadata));

    // Assert.
    expect(newState.metadata).toEqual(newMetadata);
    expect(newState.metadataChanged).toEqual(true);
  });

  it("handles an uploadFile/pending action", () => {
    // Arrange.
    const state: UploadState = fakeState().uploads;
    // Make it look like we have a pending file.
    const awaitingFile = fakeFrontendFileEntity();
    awaitingFile.status = FileStatus.AWAITING_UPLOAD;
    const doneFile = fakeFrontendFileEntity();
    doneFile.status = FileStatus.COMPLETE;
    state.ids = [awaitingFile.id, doneFile.id];
    state.entities[awaitingFile.id] = awaitingFile;
    state.entities[doneFile.id] = doneFile;

    // Act.
    const newState = uploadReducer(state, {
      type: thunkUploadFile.typePrefix + "/pending",
      meta: { arg: { fileId: awaitingFile.id } },
    });

    // Assert.
    // It should have modified the status of the pending file.
    expect(newState.entities[awaitingFile.id]?.status).toEqual(
      FileStatus.UPLOADING
    );
    // It should not have changed the status of the complete file.
    expect(newState.entities[doneFile.id]?.status).toEqual(FileStatus.COMPLETE);
  });

  it("handles an uploadFile/fulfilled action", () => {
    // Arrange.
    const state: UploadState = fakeState().uploads;
    // Make it look like we have a processing file.
    const processingFile = fakeFrontendFileEntity();
    processingFile.status = FileStatus.UPLOADING;
    const doneFile = fakeFrontendFileEntity();
    doneFile.status = FileStatus.COMPLETE;
    state.ids = [processingFile.id, doneFile.id];
    state.entities[processingFile.id] = processingFile;
    state.entities[doneFile.id] = doneFile;

    // Act.
    const newState = uploadReducer(state, {
      type: thunkUploadFile.typePrefix + "/fulfilled",
      meta: { arg: { fileId: processingFile.id } },
    });

    // Assert.
    // It should have modified the status of the pending file.
    expect(newState.entities[processingFile.id]?.status).toEqual(
      FileStatus.COMPLETE
    );
    // It should not have changed the status of the complete file.
    expect(newState.entities[doneFile.id]?.status).toEqual(FileStatus.COMPLETE);
  });

  it("handles an inferMetadata/pending action", () => {
    // Arrange.
    const state: UploadState = fakeState().uploads;
    // Make it look like we have not started metadata inference.
    state.metadataStatus = MetadataInferenceStatus.NOT_STARTED;

    // Act.
    const newState = uploadReducer(state, {
      type: thunkInferMetadata.typePrefix + "/pending",
    });

    // Assert.
    // It should have updated the metadata inference status.
    expect(newState.metadataStatus).toEqual(MetadataInferenceStatus.LOADING);
  });

  it("handles an inferMetadata/fulfilled action", () => {
    // Arrange.
    const state: UploadState = fakeState().uploads;
    // Make it look like we have started metadata inference.
    state.metadataStatus = MetadataInferenceStatus.LOADING;
    // Make it look like we have no metadata yet.
    state.metadata = null;

    const metadata = fakeImageMetadata();

    // Act.
    const newState = uploadReducer(state, {
      type: thunkInferMetadata.typePrefix + "/fulfilled",
      payload: metadata,
    });

    // Assert.
    expect(newState.metadataStatus).toEqual(MetadataInferenceStatus.COMPLETE);
    expect(newState.metadata).toEqual(metadata);
  });

  it("handles an addSelectedFiles action", () => {
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
      type: addSelectedFiles.type,
      payload: [file1, file2],
    });

    // Assert.
    // It should have added the files.
    expect(newState.ids).toHaveLength(2);
    expect(newState.ids).toContain(file1.id);
    expect(newState.ids).toContain(file2.id);

    // It should have marked the drag-and-drop action as finished.
    expect(newState.isDragging).toEqual(false);
    // It should have marked the uploads as in-progress.
    expect(newState.uploadsInProgress).toEqual(2);
    expect(newState.status).toEqual(UploadWorkflowStatus.UPLOADING);
  });

  it("handles a preProcessFiles/pending action", () => {
    // Arrange.
    const file1 = fakeFrontendFileEntity();
    file1.status = FileStatus.PENDING;
    const file2 = fakeFrontendFileEntity();
    file2.status = FileStatus.PENDING;
    const state: UploadState = fakeState().uploads;
    const fileIds = [file1.id, file2.id];
    state.ids = fileIds;
    state.entities[file1.id] = file1;
    state.entities[file2.id] = file2;

    // Act.
    const newState = uploadReducer(state, {
      type: thunkPreProcessFiles.pending.type,
      meta: { arg: { fileIds } },
    });

    // Assert.
    // It should have updated the status of both files to pre-processing.
    expect(newState.entities[file1.id]?.status).toEqual(
      FileStatus.PRE_PROCESSING
    );
    expect(newState.entities[file2.id]?.status).toEqual(
      FileStatus.PRE_PROCESSING
    );
  });

  it("handles a preProcessFiles/fulfilled action", () => {
    // Arrange.
    const file1 = fakeFrontendFileEntity();
    file1.status = FileStatus.PRE_PROCESSING;
    const file2 = fakeFrontendFileEntity();
    file2.status = FileStatus.PRE_PROCESSING;
    const state: UploadState = fakeState().uploads;
    state.ids = [file1.id, file2.id];
    state.entities[file1.id] = file1;
    state.entities[file2.id] = file2;

    const processedFiles = [
      { id: file1.id, dataUrl: faker.internet.url() },
      { id: file2.id, dataUrl: faker.internet.url() },
    ];

    // Act.
    const newState = uploadReducer(state, {
      type: thunkPreProcessFiles.fulfilled.type,
      payload: processedFiles,
    });

    // Assert.
    expect(newState.entities[file1.id]?.status).toEqual(
      FileStatus.AWAITING_UPLOAD
    );
    expect(newState.entities[file1.id]?.thumbnailUrl).toEqual(
      processedFiles[0].dataUrl
    );
    expect(newState.entities[file2.id]?.status).toEqual(
      FileStatus.AWAITING_UPLOAD
    );
    expect(newState.entities[file2.id]?.thumbnailUrl).toEqual(
      processedFiles[1].dataUrl
    );
  });

  it(`handles a ${thunkFinishUpload.pending.type} action`, () => {
    // Arrange.
    const state: UploadState = fakeState().uploads;

    // Act.
    const newState = uploadReducer(state, {
      type: thunkFinishUpload.pending.type,
    });

    // Assert.
    expect(newState.status).toEqual(UploadWorkflowStatus.FINALIZING);
  });

  it(`handles a ${thunkFinishUpload.fulfilled.type} action`, () => {
    // Arrange.
    const state: UploadState = fakeState().uploads;

    // Act.
    const newState = uploadReducer(state, {
      type: thunkFinishUpload.fulfilled.type,
    });

    // Assert.
    expect(newState.status).toEqual(UploadWorkflowStatus.WAITING);
  });
});
