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
import { ThunkAction } from "redux-thunk";
import { ObjectRef, UavImageMetadata } from "mallard-api";
import { cloneDeep } from "lodash";
import { thunkClearImageView } from "./thumbnail-grid-slice";
import pica from "pica";
import imageBlobReduce from "image-blob-reduce";

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

/** Pica instance to use. */
// eslint-disable-next-line new-cap
const gPica = new pica({
  features: ["ww", "wasm"],
});
// eslint-disable-next-line new-cap
const gBlobReduce = new imageBlobReduce({ pica: gPica });

// Customization for image-blob-reduce functionality.
// istanbul ignore next
// @ts-ignore
gBlobReduce._create_blob = function (env) {
  return (
    // @ts-ignore
    this.pica
      // @ts-ignore
      .toBlob(env.out_canvas, "image/jpeg", 0.8)
      .then(function (blob: Blob) {
        env.out_blob = blob;
        return env;
      })
  );
};

// istanbul ignore next
// @ts-ignore
gBlobReduce._transform = function (env) {
  // @ts-ignore
  env.out_canvas = this.pica.options.createCanvas(
    env.transform_width,
    env.transform_height
  );

  // Dim env temporary vars to prohibit use and avoid confusion when orientation
  // changed. You should take real size from canvas.
  env.transform_width = null;
  env.transform_height = null;

  // By default use alpha for png only
  const picaOpts = { alpha: env.blob.type === "image/png", filter: "box" };

  // Extract pica options if been passed
  // @ts-ignore
  this.utils.assign(picaOpts, this.utils.pick_pica_resize_options(env.opts));

  // @ts-ignore
  return this.pica
    .resize(env.image, env.out_canvas, picaOpts)
    .then(function () {
      return env;
    });
};

/**
 * Supported image file types. We limit ourselves to ones with broad
 * browser support.
 */
const SUPPORTED_IMAGE_TYPES = new Set<string>([
  "image/apng",
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "image/webp",
]);

/**
 * Action that specifies new files to upload that were
 * selected by the user and need to be processed.
 */
interface AddSelectedFilesAction extends Action {
  payload: FrontendFileEntity[];
}

/**
 * Adds new files that the user selected to the state.
 * @param {Map<string, File>} files Maps file IDs to the new files.
 * @return {AddSelectedFilesAction} The new file entities to add to the state.
 */
export const addSelectedFiles = createAction(
  "upload/addSelectedFiles",
  function prepare(files: Map<string, File>) {
    const frontendFiles: FrontendFileEntity[] = [];
    for (const [id, file] of files) {
      if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
        // Filter invalid files.
        continue;
      }

      frontendFiles.push({
        id: id,
        thumbnailUrl: null,
        name: file.name,
        status: FileStatus.PENDING,
      });
    }

    return { payload: frontendFiles };
  }
);

/** Represents a file ID with corresponding data URL. */
interface FileIdWithData {
  id: string;
  dataUrl: string;
}

/**
 * Custom action creator for the `preProcessFiles` action.
 * It handles pre-processing files and preparing them for upload.
 * @param {string[]} fileIds The IDs of the files to pre-process.
 * @param {Map<string, File>} idsToFiles Map of file IDs to the actual file
 *  data, which is not stored in Redux.
 * @return {FileIdWithData[]} The thunk that produces the necessary updates
 *  for entities in the state.
 */
export const thunkPreProcessFiles = createAsyncThunk(
  "upload/preProcessFiles",
  async (
    {
      fileIds,
      idsToFiles,
    }: { fileIds: string[]; idsToFiles: Map<string, File> },
    { getState }
  ): Promise<FileIdWithData[]> => {
    // Get the corresponding file entities.
    const state = getState() as RootState;
    const fileEntities = fileIds.map(
      (id) => uploadSelectors.selectById(state, id) as FrontendFileEntity
    );

    // Create thumbnails for the images.
    const thumbnailUrlPromises = fileEntities.map(async (entity) => {
      // Read the file data.
      const file = idsToFiles.get(entity.id) as File;
      const resizedImage = await gBlobReduce.toBlob(file, {
        max: 128,
      });
      return URL.createObjectURL(resizedImage);
    });
    const thumbnailUrls = await Promise.all(thumbnailUrlPromises);

    return fileIds.map((id, i) => ({
      id: id,
      dataUrl: thumbnailUrls[i],
    }));
  }
);

/**
 * Action creator that uploads files to the backend.
 * @param {string} fileId The ID of the file to upload.
 * @param {Map<string, File>} idsToFiles Map of file IDs to the actual file
 *  data, which is not stored in Redux.
 */
export const thunkUploadFile = createAsyncThunk(
  "upload/uploadFile",
  async ({
    fileId,
    idsToFiles,
  }: {
    fileId: string;
    idsToFiles: Map<string, File>;
  }): Promise<ObjectRef> => {
    // Obtain the file with this ID.
    const uploadFile = idsToFiles.get(fileId) as File;

    // Upload all the files.
    // File should always be loaded at the time we perform this action.
    return await createImage(uploadFile, {
      name: uploadFile.name,
      metadata: {},
    });
  }
);

/**
 * Action creator that infers metadata from a provided file.
 * @param {string} fileId The ID of the file to infer metadata for.
 * @param {Map<string, File>} idsToFiles Map of file IDs to the actual file
 *  data, which is not stored in Redux.
 */
export const thunkInferMetadata = createAsyncThunk(
  "upload/inferMetadata",
  async ({
    fileId,
    idsToFiles,
  }: {
    fileId: string;
    idsToFiles: Map<string, File>;
  }): Promise<UavImageMetadata> => {
    // Obtain the file with this ID.
    const uploadFile = idsToFiles.get(fileId) as File;

    // Infer the metadata.
    return await inferMetadata(uploadFile, {
      name: uploadFile.name,
      knownMetadata: {},
    });
  },
  {
    condition: (_, { getState }) => {
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
      if (file.thumbnailUrl) {
        URL.revokeObjectURL(file.thumbnailUrl);
      }
    }

    if (state.uploads.metadataChanged) {
      // The user changed the metadata. Update it on the backend.
      dispatch(
        thunkUpdateMetadata(uploadSelectors.selectIds(state) as string[])
      );
    }

    dispatch(uploadSlice.actions.dialogClosed(null));
    // Force a refresh of the thumbnail grid to display new uploaded data.
    dispatch(thunkClearImageView());
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
        id: action.meta.arg.fileId,
        changes: { status: FileStatus.UPLOADING },
      });
    });
    // Updates the state when an upload to the backend finishes.
    builder.addCase(thunkUploadFile.fulfilled, (state, action) => {
      // Mark the file upload as complete.
      const fileId = action.meta.arg.fileId;
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
      addSelectedFiles.type,
      (state, action: AddSelectedFilesAction) => {
        // Add all the uploaded files.
        uploadAdapter.addMany(state, action.payload);

        // Mark the drag as complete.
        state.isDragging = false;
        // Mark these as in-progress uploads.
        state.uploadsInProgress += action.payload.length;
      }
    );
    // New files are being pre-processed.
    builder.addCase(thunkPreProcessFiles.pending, (state, action) => {
      // Mark all the modified files as pre-processing.
      const fileIds = action.meta.arg.fileIds;
      const updates = fileIds.map((id) => ({
        id: id,
        changes: { status: FileStatus.PRE_PROCESSING },
      }));
      uploadAdapter.updateMany(state, updates);
    });
    // New files have been pre-processed.
    builder.addCase(thunkPreProcessFiles.fulfilled, (state, action) => {
      // Update the specified entities.
      const updates = action.payload.map((e) => ({
        id: e.id,
        changes: {
          status: FileStatus.AWAITING_UPLOAD,
          thumbnailUrl: e.dataUrl,
        },
      }));
      uploadAdapter.updateMany(state, updates);
    });
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
