import {
  createAsyncThunk,
  createEntityAdapter,
  createSlice,
} from "@reduxjs/toolkit";
import {
  ArtifactId,
  ImageEntity,
  ImageQuery,
  QueryResult,
  RequestState,
  RootState,
  ThumbnailGridState,
  ThumbnailStatus,
} from "./types";
import { loadThumbnail, queryImages } from "./api-client";

/**
 * Return type for the `thunkStartQuery` creator.
 */
interface StartQueryReturn {
  query: ImageQuery;
  result: QueryResult;
}

/**
 * Return type for the `thunkLoadThumbnail` creator.
 */
interface LoadThumbnailReturn {
  imageId: string;
  imageUrl: string;
}

/**
 * Creates a unique ID to use for an image based on the backend ID.
 * @param {ArtifactId} backendId The ID used by the backend.
 * @return {string} The equivalent ID used by the frontend.
 */
function createImageEntityId(backendId: ArtifactId): string {
  return backendId.bucket + "/" + backendId.name;
}

const thumbnailGridAdapter = createEntityAdapter<ImageEntity>({
  selectId: (entity) => createImageEntityId(entity.backendId),
});
const initialState: ThumbnailGridState = thumbnailGridAdapter.getInitialState({
  lastQueryResults: null,
  currentQuery: null,
  currentQueryState: RequestState.IDLE,
  currentQueryError: null,
});

/** Memoized selectors for the state. */
export const thumbnailGridSelectors = thumbnailGridAdapter.getSelectors<RootState>(
  (state) => state.thumbnailGrid
);

/**
 * Action creator that starts a new request for thumbnails on the homepage.
 */
export const thunkStartQuery = createAsyncThunk(
  "thumbnailGrid/startQuery",
  async (query: ImageQuery): Promise<StartQueryReturn> => {
    // Perform the query.
    return { query: query, result: await queryImages(query) };
  }
);

/**
 * Action creator that starts a new request for an image thumbnail.
 */
export const thunkLoadThumbnail = createAsyncThunk(
  "thumbnailGrid/loadThumbnail",
  async (imageId: string, { getState }): Promise<LoadThumbnailReturn> => {
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

export const thumbnailGridSlice = createSlice({
  name: "thumbnailGrid",
  initialState: initialState as ThumbnailGridState,
  reducers: {},
  extraReducers: (builder) => {
    // Initiates a new query for home screen data.
    builder.addCase(thunkStartQuery.pending, (state) => {
      if (state.currentQueryState == RequestState.LOADING) {
        // A query is already in-progress.
        return;
      }

      state.currentQueryState = RequestState.LOADING;
    });

    // Adds (possibly partial) results from a query.
    builder.addCase(thunkStartQuery.fulfilled, (state, action) => {
      state.currentQueryState = RequestState.SUCCEEDED;

      // Mark these thumbnails as currently loading.
      thumbnailGridAdapter.addMany(
        state,
        action.payload.result.imageIds.map((i) => {
          return {
            backendId: i,
            status: ThumbnailStatus.LOADING,
            imageUrl: null,
          };
        })
      );

      if (action.payload.result.isLastPage) {
        // We have gotten all the results from this query, so it is now complete.
        state.currentQuery = null;
      } else {
        // We have not gotten all the results, so the query will have to be rerun at some point.
        state.currentQuery = action.payload.query;
      }
    });

    // Adds results from thumbnail loading.
    builder.addCase(thunkLoadThumbnail.fulfilled, (state, action) => {
      // Move images from the loading set to the visible set, and save the image URL.
      thumbnailGridAdapter.updateOne(state, {
        id: action.payload.imageId,
        changes: {
          status: ThumbnailStatus.VISIBLE,
          imageUrl: action.payload.imageUrl,
        },
      });
    });
  },
});

export default thumbnailGridSlice.reducer;
