import {
  fakeEditableMetadata,
  fakeFile,
  fakeFrontendFileEntity,
  fakeImageMetadata,
  fakeObjectRef,
  fakeState,
  fakeVideoMetadata,
} from "./element-test-utils";
import uploadReducer, {
  addSelectedFiles,
  dialogClosed,
  dialogOpened,
  fileDropZoneEntered,
  fileDropZoneExited,
  setMetadata,
  thunkFinishUpload,
  thunkInferMetadata,
  thunkPreProcessFiles,
  thunkUploadFile,
  updateProgress,
  uploadSlice,
} from "../upload-slice";
import {
  EditableMetadata,
  FileStatus,
  filterOnlyEditable,
  FrontendFileEntity,
  MetadataInferenceStatus,
  UploadState,
  UploadWorkflowStatus,
} from "../types";
import { Store } from "@reduxjs/toolkit";
import each from "jest-each";
import { thunkClearImageView } from "../thumbnail-grid-slice";
import imageBlobReduce, {
  ImageBlobReduce,
  ImageBlobReduceStatic,
} from "image-blob-reduce";
import { faker } from "@faker-js/faker";
import { ObjectType, UavImageMetadata, UavVideoMetadata } from "mallard-api";
import {
  batchUpdateMetadata,
  createImage,
  createVideo,
  inferImageMetadata,
  inferVideoMetadata,
} from "../api-client";
import { RootState, setupStore } from "../store";
import MockedFn = jest.MockedFn;

// Mock out the gateway API.
jest.mock("../api-client", () => ({
  createImage: jest.fn(),
  createVideo: jest.fn(),
  inferImageMetadata: jest.fn(),
  inferVideoMetadata: jest.fn(),
  batchUpdateMetadata: jest.fn(),
}));

const mockCreateImage = createImage as jest.MockedFn<typeof createImage>;
const mockCreateVideo = createVideo as jest.MockedFn<typeof createVideo>;
const mockInferImageMetadata = inferImageMetadata as jest.MockedFn<
  typeof inferImageMetadata
>;
const mockInferVideoMetadata = inferVideoMetadata as jest.MockedFn<
  typeof inferVideoMetadata
>;
const mockUpdateMetadata = batchUpdateMetadata as jest.MockedFn<
  typeof batchUpdateMetadata
>;

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
  /** Stores the mocked global instance of imageBlobReduce. */
  let mockImageBlobReduceInstance: jest.MockedObject<ImageBlobReduce>;

  beforeAll(() => {
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

  each([
    ["images", ObjectType.IMAGE],
    ["videos", ObjectType.VIDEO],
  ]).describe("async thunks with %s", (_: string, objectType: ObjectType) => {
    /** A fake state to use for testing. */
    let state: RootState;
    /** A fake upload file to use for testing. */
    let awaitingFile: FrontendFileEntity;
    /** A fake uploaded file to use for testing. */
    let doneFile: FrontendFileEntity;
    /** A fake set of uploaded files for testing. */
    let idsToFiles: Map<string, File>;
    /** A fake Redux store to use for testing. */
    let store: Store;

    beforeEach(() => {
      // Initialize a fake store with valid state.
      state = fakeState();
      state.uploads.dialogOpen = true;

      // The state should have a single pending file.
      awaitingFile = fakeFrontendFileEntity(undefined, objectType);
      awaitingFile.status = FileStatus.AWAITING_UPLOAD;
      idsToFiles = new Map([[awaitingFile.id, fakeFile()]]);
      state.uploads.uploadsInProgress = 1;

      // Also, make it look like we have a done file.
      doneFile = fakeFrontendFileEntity();
      doneFile.status = FileStatus.COMPLETE;
      state.uploads.uploadsCompleted = 1;

      state.uploads.ids = [awaitingFile.id, doneFile.id];
      state.uploads.entities[awaitingFile.id] = awaitingFile;
      state.uploads.entities[doneFile.id] = doneFile;

      store = setupStore(state);
    });

    it("creates an uploadFile action", async () => {
      // Arrange.
      // Make it look like the create request succeeds.
      const newFileId = fakeObjectRef();
      let uploadFunction:
        | MockedFn<typeof createImage>
        | MockedFn<typeof createVideo> = mockCreateImage;
      if (objectType === ObjectType.VIDEO) {
        uploadFunction = mockCreateVideo;
      }
      uploadFunction.mockResolvedValue(newFileId);

      // Act.
      const uploadFilePromise = thunkUploadFile({
        fileId: awaitingFile.id,
        idsToFiles: idsToFiles,
      })(store.dispatch, store.getState, {});

      // Assert.
      // It should have modified the status of the pending file.
      let newState: UploadState = store.getState().uploads;
      expect(newState.entities[awaitingFile.id]?.status).toEqual(
        FileStatus.UPLOADING
      );
      // It should not have changed the status of the complete file.
      expect(newState.entities[doneFile.id]?.status).toEqual(
        FileStatus.COMPLETE
      );

      // Act.
      // Wait for the upload to finish.
      await uploadFilePromise;

      // Assert.
      // It should have uploaded the image.
      const fakeFile = idsToFiles.get(awaitingFile.id) as File;
      expect(uploadFunction).toHaveBeenCalledTimes(1);
      expect(uploadFunction).toHaveBeenCalledWith(
        fakeFile,
        {
          name: fakeFile.name,
          metadata: {},
        },
        expect.anything()
      );

      // The process callback should dispatch a new action to update the
      // progress.
      const progressCallback = uploadFunction.mock.calls[0][2] as (
        percentDone: number
      ) => void;
      const progress = faker.datatype.number({ min: 0, max: 100 });
      progressCallback(progress);

      newState = store.getState().uploads;

      // It should have modified the status of the pending file.
      expect(newState.entities[awaitingFile.id]?.status).toEqual(
        FileStatus.COMPLETE
      );
      // It should not have changed the status of the complete file.
      expect(newState.entities[doneFile.id]?.status).toEqual(
        FileStatus.COMPLETE
      );

      // It should have decremented the number of uploads in progress.
      expect(newState.uploadsInProgress).toEqual(0);
      // It should have incremented the number of completed uploads.
      expect(newState.uploadsCompleted).toEqual(2);
    });

    it("creates an inferMetadata action", async () => {
      // Arrange.
      // Inference must not have been started yet for this to succeed.
      state.uploads.metadataStatus = MetadataInferenceStatus.NOT_STARTED;
      // Make it look like we have no metadata yet.
      state.uploads.metadata = null;
      store = setupStore(state);

      // Make it look like the inference request succeeds.
      let metadata: UavVideoMetadata | UavImageMetadata = fakeImageMetadata();
      if (objectType === ObjectType.IMAGE) {
        mockInferImageMetadata.mockResolvedValue(metadata);
      } else if (objectType === ObjectType.VIDEO) {
        metadata = fakeVideoMetadata();
        mockInferVideoMetadata.mockResolvedValue(metadata);
      }

      // Act.
      const inferMetadataPromise = thunkInferMetadata({
        fileId: awaitingFile.id,
        idsToFiles: idsToFiles,
      })(store.dispatch, store.getState, {});

      // It should have updated the metadata inference status.
      let newState: UploadState = store.getState().uploads;
      expect(newState.metadataStatus).toEqual(MetadataInferenceStatus.LOADING);

      // Act.
      await inferMetadataPromise;

      // Assert.
      // It should have inferred the metadata.
      const fakeFile = idsToFiles.get(awaitingFile.id);
      if (objectType === ObjectType.IMAGE) {
        expect(mockInferImageMetadata).toHaveBeenCalledWith(
          fakeFile,
          expect.anything()
        );
      } else if (objectType === ObjectType.VIDEO) {
        expect(mockInferVideoMetadata).toHaveBeenCalledWith(
          fakeFile,
          expect.anything()
        );
      }

      newState = store.getState().uploads;
      expect(newState.metadataStatus).toEqual(MetadataInferenceStatus.COMPLETE);
      expect(newState.metadata).toEqual(filterOnlyEditable(metadata));
    });

    it("does not dispatch inferMetadata if inference is in-progress", async () => {
      // Arrange.
      // Make it look like inference has started already.
      state.uploads.metadataStatus = MetadataInferenceStatus.LOADING;
      store = setupStore(state);

      // Act.
      await thunkInferMetadata({
        fileId: awaitingFile.id,
        idsToFiles: idsToFiles,
      })(store.dispatch, store.getState, {});

      // Assert.
      // It should have done nothing.
      const newState = store.getState();
      expect(newState).toEqual(state);
    });

    it("creates a preProcessFiles action", async () => {
      // Arrange.
      // Add some pending files to the state.
      const file1 = fakeFrontendFileEntity(FileStatus.PENDING, objectType);
      const file2 = fakeFrontendFileEntity(FileStatus.PENDING, objectType);
      const state = fakeState();
      const fileIds = [file1.id, file2.id];
      state.uploads.ids = fileIds;
      state.uploads.entities[file1.id] = file1;
      state.uploads.entities[file2.id] = file2;
      store = setupStore(state);

      // Create fake files.
      idsToFiles = new Map([
        [file1.id, fakeFile()],
        [file2.id, fakeFile()],
      ]);

      // Make it look like it produces a valid thumbnail blob.
      const mockToBlob = mockImageBlobReduceInstance.toBlob;
      const thumbnailBlob = fakeFile();
      mockToBlob.mockResolvedValue(thumbnailBlob);

      // Create a fake thumbnail URL.
      const thumbnailUrl = faker.internet.url();
      mockCreateObjectUrl.mockReturnValue(thumbnailUrl);

      // Act.
      const preProcessPromise = thunkPreProcessFiles({ fileIds, idsToFiles })(
        store.dispatch,
        store.getState,
        {}
      );

      // Assert.
      // It should have updated the status of both files to pre-processing.
      let newState: UploadState = store.getState().uploads;
      expect(newState.entities[file1.id]?.status).toEqual(
        FileStatus.PRE_PROCESSING
      );
      expect(newState.entities[file2.id]?.status).toEqual(
        FileStatus.PRE_PROCESSING
      );

      // Act.
      await preProcessPromise;

      // Assert.
      if (objectType === ObjectType.IMAGE) {
        // It should have created thumbnails for the images.
        expect(mockToBlob).toHaveBeenCalledTimes(2);
        for (const fileId of fileIds) {
          const fakeFileData = idsToFiles.get(fileId) as File;
          expect(mockToBlob).toHaveBeenCalledWith(
            fakeFileData,
            expect.anything()
          );
        }

        expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
        expect(URL.createObjectURL).toHaveBeenCalledWith(thumbnailBlob);
      }

      // Check that the file status was set correctly.
      newState = store.getState().uploads;
      expect(newState.entities[file1.id]?.status).toEqual(
        FileStatus.AWAITING_UPLOAD
      );
      expect(newState.entities[file2.id]?.status).toEqual(
        FileStatus.AWAITING_UPLOAD
      );
      if (objectType == ObjectType.IMAGE) {
        // We only have thumbnails for images right now.
        expect(newState.entities[file1.id]?.thumbnailUrl).toEqual(thumbnailUrl);
        expect(newState.entities[file2.id]?.thumbnailUrl).toEqual(thumbnailUrl);
      } else {
        expect(newState.entities[file1.id]?.thumbnailUrl).toBeNull();
        expect(newState.entities[file2.id]?.thumbnailUrl).toBeNull();
      }
    });

    each([
      ["changed metadata", true, fakeEditableMetadata()],
      ["unchanged metadata", false, fakeEditableMetadata()],
      ["no metadata", true, null],
    ]).it(
      "finalizes the upload with %s",
      async (
        _: string,
        hasNewMetadata: boolean,
        metadata: EditableMetadata | null
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

        const store = setupStore(state);

        // Use a dummy action here to simulate how this thunk works.
        // mockClearImageView.mockReturnValue((dispatch) => {
        //   dispatch({ type: "thunkClearImageView", payload: undefined });
        // });

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
            // It should have performed the request.
            expect(mockUpdateMetadata).toHaveBeenCalledWith(
              state.uploads.metadata,
              [uploadFile.backendRef]
            );
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
    const newState = uploadSlice.reducer(state, dialogOpened());

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
    const newState = uploadSlice.reducer(state, dialogClosed());

    // Assert.
    // It should have set the dialog to opened.
    expect(newState.dialogOpen).toEqual(false);
    // It should have cleared any existing files.
    expect(newState.ids).toHaveLength(0);
    // It should have reset the number of completed uploads.
    expect(newState.uploadsCompleted).toEqual(0);
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

  it("handles an updateProgress action", () => {
    // Arrange.
    const state: UploadState = fakeState().uploads;

    // Create a fake file that is being uploaded.
    const uploadingFile = fakeFrontendFileEntity(FileStatus.UPLOADING);
    uploadingFile.uploadProgress = 0.0;
    state.ids = [uploadingFile.id];
    state.entities[uploadingFile.id] = uploadingFile;

    // Act.
    const newProgress = faker.datatype.number({ min: 0.0, max: 100.0 });
    const newState = uploadSlice.reducer(
      state,
      updateProgress({
        id: uploadingFile.id,
        progress: newProgress,
      })
    );

    // Assert.
    expect(newState.entities[uploadingFile.id]?.uploadProgress).toEqual(
      newProgress
    );
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
