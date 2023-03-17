import {
  FileStatus,
  FrontendFileEntity,
  MetadataInferenceStatus,
  RootState,
  UploadState,
} from "./types";
import {
  createAction,
  createAsyncThunk,
  createEntityAdapter,
  createSlice,
} from "@reduxjs/toolkit";
import { batchUpdateMetadata, createImage, inferMetadata } from "./api-client";
import { Action } from "redux";
import { v4 as uuidv4 } from "uuid";
import { ThunkAction } from "redux-thunk";
import { ObjectRef, UavImageMetadata } from "mallard-api";
import { cloneDeep } from "lodash";

/** Type alias to make typing thunks simpler. */
type ThunkResult<R> = ThunkAction<R, RootState, any, any>;

const uploadAdapter = createEntityAdapter<FrontendFileEntity>();
const initialState: UploadState = uploadAdapter.getInitialState({
  isDragging: false,
  dialogOpen: false,
  uploadsInProgress: 0,

  metadataStatus: MetadataInferenceStatus.NOT_STARTED,
  metadata: null,
  metadataChanged: false,
});

/** Memoized selectors for the state. */
export const uploadSelectors = uploadAdapter.getSelectors<RootState>(
  (state) => state.uploads
);
/** Selectors that work on just the upload slice. */
const sliceSelectors = uploadAdapter.getSelectors();

/**
 * Represents loaded file data.
 */
interface UploadFileData {
  /** The actual contents of the file. */
  contents: Blob;
  /** The name of the file. */
  name: string;
}

/**
 * Convenience function to retrieve the raw data for a file being uploaded.
 * @param {string} fileId The ID of the file in the state.
 * @param {string} state The current state.
 * @return {UploadFileData} The raw data from this file.
 */
async function getUploadFile(
  fileId: string,
  state: RootState
): Promise<UploadFileData> {
  // Obtain the file with this ID.
  const uploadFile = uploadSelectors.selectById(
    state,
    fileId
  ) as FrontendFileEntity;

  // Load the actual contents of the file.
  const fileReadResponse = await fetch(uploadFile.dataUrl);
  return { contents: await fileReadResponse.blob(), name: uploadFile.name };
}

/**
 * Action creator that uploads files to the backend.
 * It takes a file entity to upload.
 */
export const thunkUploadFile = createAsyncThunk(
  "upload/uploadFile",
  async (fileId: string, { getState }): Promise<ObjectRef> => {
    // Obtain the file with this ID.
    const state = getState() as RootState;
    const uploadFile = await getUploadFile(fileId, state);

    // Upload all the files.
    // File should always be loaded at the time we perform this action.
    return await createImage(uploadFile.contents, {
      name: uploadFile.name,
      metadata: {},
    });
  }
);

/**
 * Action creator that infers metadata from a provided file.
 */
export const thunkInferMetadata = createAsyncThunk(
  "upload/inferMetadata",
  async (fileId: string, { getState }): Promise<UavImageMetadata> => {
    // Obtain the file with this ID.
    const state = getState() as RootState;
    const uploadFile = await getUploadFile(fileId, state);

    // Infer the metadata.
    return await inferMetadata(uploadFile.contents, {
      name: uploadFile.name,
      knownMetadata: {},
    });
  },
  {
    condition: (fileId: string, { getState }) => {
      const state = getState() as RootState;
      if (state.uploads.metadataStatus != MetadataInferenceStatus.NOT_STARTED) {
        // We have already completed or are performing metadata inference.
        // There is no need to start it again.
        return false;
      }
    },
  }
);

/**
 * Action creator that updates metadata for a set of files. It will use
 * the metadata currently specified in the state.
 */
export const thunkUpdateMetadata = createAsyncThunk(
  "upload/updateMetadata",
  async (fileIds: string[], { getState }): Promise<void> => {
    // Get the backend IDs for all the files.
    const state = getState() as RootState;
    const objectRefs = fileIds.map((fileId) => {
      const file = uploadSelectors.selectById(
        state,
        fileId
      ) as FrontendFileEntity;

      return file.backendRef as ObjectRef;
    });

    // Do not specify names, because we want these to be inferred so that
    // they're all unique.
    const useMetadata = cloneDeep(state.uploads.metadata);
    if (useMetadata !== null) {
      useMetadata.name = undefined;
    }

    // Perform the updates.
    await batchUpdateMetadata(useMetadata as UavImageMetadata, objectRefs);
  }
);

/**
 * Action that specifies new files to upload that were
 * selected by the user and need to be processed.
 */
interface ProcessSelectedFilesAction extends Action {
  payload: FrontendFileEntity[];
}

/**
 * Custom action creator for the `processSelectedFiles` action.
 * It deals with translating the `DataTransferItem`s into a format
 * that can be used by Redux.
 * @param {File[]} files The new selected files.
 * @return {ProcessSelectedFilesAction} The created action.
 */
export const processSelectedFiles = createAction(
  "upload/processSelectedFiles",
  function prepare(files: File[]) {
    // Filter to only image files.
    const validFiles = files.filter((f: File) => f.type.startsWith("image/"));

    // Create data URLs for every file.
    const fileUrls = validFiles.map((file) => URL.createObjectURL(file));

    const frontendFiles = validFiles.map((file, i): FrontendFileEntity => {
      return {
        id: uuidv4(),
        dataUrl: fileUrls[i],
        name: file.name,
        status: FileStatus.PENDING,
      };
    });
    return { payload: frontendFiles };
  }
);

/**
 * Thunk that completes an upload by updating metadata on the backend, cleaning
 * up memory, and closing the upload modal.
 * @return {ThunkResult} Does not actually return anything, because it simply
 *  dispatches other actions.
 */
export function finishUpload(): ThunkResult<void> {
  return (dispatch, getState) => {
    // Release the data for all the images that we uploaded.
    const state: RootState = getState();
    for (const file of sliceSelectors.selectAll(state.uploads)) {
      URL.revokeObjectURL(file.dataUrl);
    }

    if (state.uploads.metadataChanged) {
      // The user changed the metadata. Update it on the backend.
      dispatch(
        thunkUpdateMetadata(uploadSelectors.selectIds(state) as string[])
      );
    }

    dispatch(uploadSlice.actions.dialogClosed(null));
  };
}

export const uploadSlice = createSlice({
  name: "upload",
  initialState: initialState,
  reducers: {
    // The user is initiating an upload.
    dialogOpened(state, _) {
      state.dialogOpen = true;
    },
    // The user is closing the upload dialog.
    dialogClosed(state, _) {
      state.dialogOpen = false;

      // Clear the state for the uploaded files.
      uploadAdapter.removeAll(state);
      state.metadataStatus = MetadataInferenceStatus.NOT_STARTED;
      state.metadata = null;
      state.metadataChanged = false;
    },

    // The user is dragging files to be uploaded, and they have entered
    // the drop zone.
    fileDropZoneEntered(state, _) {
      state.isDragging = true;
    },
    // The user is dragging files to be uploaded, and they have left
    // the drop zone.
    fileDropZoneExited(state, _) {
      state.isDragging = false;
    },
    // Updates the currently-set metadata.
    setMetadata(state, action) {
      state.metadata = action.payload;
      state.metadataChanged = true;
    },
  },
  extraReducers: (builder) => {
    // Updates the state when an upload to the backend starts.
    builder.addCase(thunkUploadFile.pending, (state, action) => {
      // Mark the file upload as in-progress.
      uploadAdapter.updateOne(state, {
        id: action.meta.arg,
        changes: { status: FileStatus.PROCESSING },
      });

      ++state.uploadsInProgress;
    });
    // Updates the state when an upload to the backend finishes.
    builder.addCase(thunkUploadFile.fulfilled, (state, action) => {
      // Mark the file upload as complete.
      const fileId = action.meta.arg;
      uploadAdapter.updateOne(state, {
        id: fileId,
        changes: { status: FileStatus.COMPLETE, backendRef: action.payload },
      });

      --state.uploadsInProgress;
    });
    // Updates the state when metadata inference starts.
    builder.addCase(thunkInferMetadata.pending, (state, _) => {
      // Mark metadata inference as started.
      state.metadataStatus = MetadataInferenceStatus.LOADING;
    });
    // Updates the state when the metadata inference finishes.
    builder.addCase(thunkInferMetadata.fulfilled, (state, action) => {
      // Mark metadata inference as complete.
      state.metadataStatus = MetadataInferenceStatus.COMPLETE;
      // Set the inferred metadata.
      state.metadata = action.payload;
    });
    // The user selected some new files that must be processed.
    builder.addCase(
      processSelectedFiles.type,
      (state, action: ProcessSelectedFilesAction) => {
        // Add all the uploaded files.
        uploadAdapter.addMany(state, action.payload);

        // Mark the drag as complete.
        state.isDragging = false;
      }
    );
  },
});

export const {
  dialogOpened,
  dialogClosed,
  fileDropZoneEntered,
  fileDropZoneExited,
  setMetadata,
} = uploadSlice.actions;
export default uploadSlice.reducer;
