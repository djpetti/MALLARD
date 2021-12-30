import {
  createAsyncThunk,
  createEntityAdapter,
  createSlice,
} from "@reduxjs/toolkit";
import {
  ImageEntity,
  ImageQuery,
  ImageStatus,
  ImageViewState,
  RequestState,
  RootState,
} from "./types";
import {
  getMetadata,
  loadImage,
  loadThumbnail,
  queryImages,
} from "./api-client";
import {
  ObjectRef,
  Ordering,
  QueryResponse,
  UavImageMetadata,
} from "typescript-axios";

/**
 * Return type for the `thunkStartQuery` creator.
 */
interface StartQueryReturn {
  query: ImageQuery;
  result: QueryResponse;
}

/**
 * Return type for the `thunkLoadThumbnail` and `thunkLoadImage` creators.
 */
interface LoadImageReturn {
  imageId: string;
  imageUrl: string;
}

/**
 * Return type for the `thunkLoadMetadata` creator.
 */
interface LoadMetadataReturn {
  imageIds: string[];
  metadata: UavImageMetadata[];
}

/**
 * Creates a unique ID to use for an image based on the backend ID.
 * @param {ObjectRef} backendId The ID used by the backend.
 * @return {string} The equivalent ID used by the frontend.
 */
export function createImageEntityId(backendId: ObjectRef): string {
  return `${backendId.bucket}_${backendId.name}`;
}

/**
 * Creates an image entity with default values for all the attributes.
 * @param {ObjectRef} backendId ID of the entity on the backend.
 * @return {ImageEntity} The entity that it created.
 */
function createDefaultEntity(backendId: ObjectRef): ImageEntity {
  return {
    backendId: backendId,
    thumbnailStatus: ImageStatus.LOADING,
    imageStatus: ImageStatus.LOADING,
    thumbnailUrl: null,
    imageUrl: null,
    metadata: null,
  };
}

const thumbnailGridAdapter = createEntityAdapter<ImageEntity>({
  selectId: (entity) => createImageEntityId(entity.backendId),
});
const initialState: ImageViewState = thumbnailGridAdapter.getInitialState({
  lastQueryResults: null,
  currentQuery: null,
  currentQueryState: RequestState.IDLE,
  metadataLoadingState: RequestState.IDLE,
  currentQueryError: null,
  lastQueryHasMorePages: true,
});

/** Memoized selectors for the state. */
export const thumbnailGridSelectors =
  thumbnailGridAdapter.getSelectors<RootState>((state) => state.imageView);

/**
 * Action creator that starts a new request for thumbnails on the homepage.
 */
export const thunkStartQuery = createAsyncThunk(
  "thumbnailGrid/startQuery",
  async ({
    query,
    orderings,
    resultsPerPage,
    pageNum,
  }: {
    query: ImageQuery;
    orderings?: Ordering[];
    resultsPerPage?: number;
    pageNum?: number;
  }): Promise<StartQueryReturn> => {
    // Perform the query.
    return {
      query: query,
      result: await queryImages(query, orderings, resultsPerPage, pageNum),
    };
  }
);

/**
 * Action creator that starts a new request for an image thumbnail.
 */
export const thunkLoadThumbnail = createAsyncThunk(
  "thumbnailGrid/loadThumbnail",
  async (imageId: string, { getState }): Promise<LoadImageReturn> => {
    // This should never be undefined, because that means our image ID is invalid.
    const imageEntity: ImageEntity = thumbnailGridSelectors.selectById(
      getState() as RootState,
      imageId
    ) as ImageEntity;
    const rawImage = await loadThumbnail(imageEntity.backendId);

    // Get the object URL for it.
    return { imageId: imageId, imageUrl: URL.createObjectURL(rawImage) };
  }
);

/**
 * Action creator that starts a new request for an image.
 */
export const thunkLoadImage = createAsyncThunk(
  "thumbnailGrid/loadImage",
  async (imageId: string, { getState }): Promise<LoadImageReturn> => {
    // This should never be undefined, because that means our image ID is invalid.
    const imageEntity: ImageEntity = thumbnailGridSelectors.selectById(
      getState() as RootState,
      imageId
    ) as ImageEntity;
    const rawImage = await loadImage(imageEntity.backendId);

    // Get the object URL for it.
    return { imageId: imageId, imageUrl: URL.createObjectURL(rawImage) };
  }
);

/**
 * Action creator that starts a new request for image metadata for multiple images.
 */
export const thunkLoadMetadata = createAsyncThunk(
  "thumbnailGrid/loadMetadata",
  async (imageIds: string[], { getState }): Promise<LoadMetadataReturn> => {
    // Asynchronously load metadata for all the images.
    const metadataPromises: Promise<UavImageMetadata>[] = imageIds.map(
      (imageId: string) => {
        // This should never be undefined, because that means our image ID is invalid.
        const imageEntity: ImageEntity = thumbnailGridSelectors.selectById(
          getState() as RootState,
          imageId
        ) as ImageEntity;

        return getMetadata(imageEntity.backendId);
      }
    );
    const metadata: UavImageMetadata[] = await Promise.all(metadataPromises);

    return { imageIds: imageIds, metadata: metadata };
  }
);

export const thumbnailGridSlice = createSlice({
  name: "thumbnailGrid",
  initialState: initialState as ImageViewState,
  reducers: {
    // We are manually adding a new artifact to the frontend state.
    addArtifact(state, action) {
      thumbnailGridAdapter.addOne(state, createDefaultEntity(action.payload));
    },
  },
  extraReducers: (builder) => {
    // We initiated a new query for home screen data.
    builder.addCase(thunkStartQuery.pending, (state) => {
      state.currentQueryState = RequestState.LOADING;
    });

    // Adds (possibly partial) results from a query.
    builder.addCase(thunkStartQuery.fulfilled, (state, action) => {
      state.currentQueryState = RequestState.SUCCEEDED;

      // Mark these thumbnails as currently loading.
      thumbnailGridAdapter.addMany(
        state,
        action.payload.result.imageIds.map((i) => createDefaultEntity(i))
      );

      if (action.payload.result.isLastPage) {
        // We have gotten all the results from this query, so it is now complete.
        state.currentQuery = null;
      } else {
        // We have not gotten all the results, so the query will have to be rerun at some point.
        state.currentQuery = action.payload.query;
      }
      state.lastQueryHasMorePages = !action.payload.result.isLastPage;
    });

    // Add results from thumbnail loading.
    builder.addCase(thunkLoadThumbnail.fulfilled, (state, action) => {
      // Transition images from LOADING to VISIBLE, and save the image URL.
      thumbnailGridAdapter.updateOne(state, {
        id: action.payload.imageId,
        changes: {
          thumbnailStatus: ImageStatus.VISIBLE,
          thumbnailUrl: action.payload.imageUrl,
        },
      });
    });

    // Add results from image loading.
    builder.addCase(thunkLoadImage.fulfilled, (state, action) => {
      // Transition images from LOADING to VISIBLE, and save the image URL.
      thumbnailGridAdapter.updateOne(state, {
        id: action.payload.imageId,
        changes: {
          imageStatus: ImageStatus.VISIBLE,
          imageUrl: action.payload.imageUrl,
        },
      });
    });

    // We initiated a new request for metadata.
    builder.addCase(thunkLoadMetadata.pending, (state, _) => {
      state.metadataLoadingState = RequestState.LOADING;
    });

    // Add results from metadata loading.
    builder.addCase(thunkLoadMetadata.fulfilled, (state, action) => {
      state.metadataLoadingState = RequestState.SUCCEEDED;

      // Save the image metadata.
      const updates = action.payload.imageIds.map(
        (imageId: string, index: number) => {
          // Get corresponding metadata.
          const metadata = action.payload.metadata[index];
          return { id: imageId, changes: { metadata: metadata } };
        }
      );

      thumbnailGridAdapter.updateMany(state, updates);
    });
  },
});

export const { addArtifact } = thumbnailGridSlice.actions;
export default thumbnailGridSlice.reducer;
