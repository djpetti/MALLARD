import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import {
  ImageQuery,
  QueryResult,
  RequestState,
  ThumbnailGridState,
} from "./types";
import { queryImages } from "./api-client";

/**
 * Return type for the `thunkStartQuery` creator.
 */
interface StartQueryReturn {
  query: ImageQuery;
  result: QueryResult;
}

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

export const thumbnailGridSlice = createSlice({
  name: "thumbnailGrid",
  initialState: {
    visibleThumbnails: [],
    loadingThumbnails: [],
    lastQueryResults: null,
    currentQuery: null,
    currentQueryState: RequestState.IDLE,
    currentQueryError: null,
  } as ThumbnailGridState,
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
      state.loadingThumbnails.concat(action.payload.result.imageIds);
      if (action.payload.result.isLastPage) {
        // We have gotten all the results from this query, so it is now complete.
        state.currentQuery = null;
      } else {
        // We have not gotten all the results, so the query will have to be rerun at some point.
        state.currentQuery = action.payload.query;
      }
    });
  },
});

export default thumbnailGridSlice.reducer;
