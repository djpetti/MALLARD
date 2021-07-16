import {
  FileStatus,
  FrontendFileEntity,
  FrontendImageMetadata,
  RootState,
  UploadState,
} from "./types";
import {
  createAction,
  createAsyncThunk,
  createEntityAdapter,
  createSlice,
} from "@reduxjs/toolkit";
import { createImage } from "./api-client";
import { Action } from "redux";
import { v4 as uuidv4 } from "uuid";
import { ThunkAction } from "redux-thunk";

/** Type alias to make typing thunks simpler. */
type ThunkResult<R> = ThunkAction<R, RootState, any, any>;

const uploadAdapter = createEntityAdapter<FrontendFileEntity>();
const initialState: UploadState = uploadAdapter.getInitialState({
  isDragging: false,
  dialogOpen: false,
});

/** Memoized selectors for the state. */
export const uploadSelectors = uploadAdapter.getSelectors<RootState>(
  (state) => state.uploads
);
/** Selectors that work on just the upload slice. */
const sliceSelectors = uploadAdapter.getSelectors();

/**
 * Action creator that uploads files to the backend.
 * It takes a file entity to upload.
 */
export const thunkUploadFile = createAsyncThunk(
  "upload/uploadFiles",
  async (fileId: string, { getState }) => {
    // Obtain the file with this ID.
    const state = getState() as RootState;
    const uploadFile = uploadSelectors.selectById(
      state,
      fileId
    ) as FrontendFileEntity;

    // Load the actual contents of the file.
    const fileReadResponse = await fetch(uploadFile.iconUrl);
    const fileContents = await fileReadResponse.blob();

    // Upload all the files.
    const metadata: FrontendImageMetadata = { name: uploadFile.name };
    // File should always be loaded at the time we perform this action.
    await createImage(fileContents, metadata);
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
 * @param {DataTransferItemList} files The new selected files.
 * @return {ProcessSelectedFilesAction} The created action.
 */
export const processSelectedFiles = createAction(
  "upload/processSelectedFiles",
  function prepare(files: DataTransferItemList) {
    // Extract all the files.
    const validFiles: File[] = [];
    for (const item of files) {
      const asFile = item.getAsFile();
      if (asFile !== null && asFile.type.startsWith("image/")) {
        validFiles.push(asFile);
      }
    }

    // Create data URLs for every file.
    const fileUrls = validFiles.map((file) => URL.createObjectURL(file));

    const frontendFiles = validFiles.map((file, i) => {
      return {
        id: uuidv4(),
        iconUrl: fileUrls[i],
        name: file.name,
        status: FileStatus.PENDING,
      };
    });
    return { payload: frontendFiles };
  }
);

/**
 * Thunk for creating a `dialogClosed` action that also handles the
 * proper memory management.
 */
export function closeDialog(): ThunkResult<void> {
  return (dispatch, getState) => {
    // Release the data for all the images that we uploaded.
    for (const file of sliceSelectors.selectAll(getState().uploads)) {
      URL.revokeObjectURL(file.iconUrl);
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
  },
  extraReducers: (builder) => {
    // Updates the state when an upload to the backend starts.
    builder.addCase(thunkUploadFile.pending, (state, action) => {
      // Mark the file upload as in-progress.
      uploadAdapter.updateOne(state, {
        id: action.meta.arg,
        changes: { status: FileStatus.PROCESSING },
      });
    });
    // Updates the state when an upload to the backend finishes.
    builder.addCase(thunkUploadFile.fulfilled, (state, action) => {
      // Mark the file upload as complete.
      const fileId = action.meta.arg;
      uploadAdapter.updateOne(state, {
        id: fileId,
        changes: { status: FileStatus.COMPLETE },
      });
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
} = uploadSlice.actions;
export default uploadSlice.reducer;
