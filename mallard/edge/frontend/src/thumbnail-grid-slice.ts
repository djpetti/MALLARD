import {
  createAsyncThunk,
  createEntityAdapter,
  createSlice,
  Draft,
} from "@reduxjs/toolkit";
import {
  ImageEntity,
  ImageQuery,
  ImageStatus,
  ImageViewState,
  QueryOptions,
  RequestState,
  RootState,
} from "./types";
import {
  deleteImages,
  getMetadata,
  loadImage,
  loadThumbnail,
  queryImages,
} from "./api-client";
import {
  Field,
  ObjectRef,
  Ordering,
  QueryResponse,
  UavImageMetadata,
} from "mallard-api";
import { ThunkAction } from "redux-thunk";
import {
  AutocompleteMenu,
  queriesFromSearchString,
  requestAutocomplete,
  Suggestions,
} from "./autocomplete";
import { downloadImageZip } from "./downloads";

// WORKAROUND for immer.js esm
// (see https://github.com/immerjs/immer/issues/557)
/* istanbul ignore next */
// @ts-ignore
window.process =
  window.process != undefined
    ? window.process
    : {
        env: {
          NODE_ENV: "production",
        },
      };

/** Type alias to make typing thunks simpler. */
type ThunkResult<R> = ThunkAction<R, RootState, any, any>;

/**
 * Return type for the `thunkStartQuery` creator.
 */
interface StartQueryReturn {
  query: ImageQuery[];
  options: QueryOptions;
  result: QueryResponse;
}

/**
 * Return type for the `thunkContinueQuery` creator.
 */
interface ContinueQueryReturn {
  pageNum: number;
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
 * Return type for the `thunkDoAutocomplete` creator
 */
interface DoAutocompleteReturn {
  /** Current search string. */
  searchString: string;
  /** Current autocomplete suggestions. */
  autocompleteSuggestions: Suggestions;
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
    thumbnailStatus: ImageStatus.NOT_LOADED,
    imageStatus: ImageStatus.NOT_LOADED,
    metadataStatus: ImageStatus.NOT_LOADED,
    thumbnailUrl: null,
    imageUrl: null,
    metadata: null,
    isSelected: false,
  };
}

const thumbnailGridAdapter = createEntityAdapter<ImageEntity>({
  selectId: (entity) => createImageEntityId(entity.backendId),
});
const initialState: ImageViewState = thumbnailGridAdapter.getInitialState({
  currentQuery: [],
  currentQueryOptions: {},
  currentQueryState: RequestState.IDLE,
  metadataLoadingState: RequestState.IDLE,
  imageDeletionState: RequestState.IDLE,
  currentQueryError: null,
  currentQueryHasMorePages: true,
  search: {
    searchString: "",
    autocompleteSuggestions: {
      menu: AutocompleteMenu.NONE,
      textCompletions: [],
    },
    queryState: RequestState.IDLE,
  },
  details: { frontendId: null },
  numItemsSelected: 0,
  bulkDownloadState: RequestState.IDLE,
});

/** Memoized selectors for the state. */
export const thumbnailGridSelectors =
  thumbnailGridAdapter.getSelectors<RootState>((state) => state.imageView);

/**
 * Action creator that starts a new request for thumbnails on the homepage.
 */
export const thunkStartNewQuery = createAsyncThunk(
  "thumbnailGrid/startNewQuery",
  async ({
    query,
    orderings,
    resultsPerPage,
    startPageNum,
  }: {
    query: ImageQuery[];
    orderings?: Ordering[];
    resultsPerPage?: number;
    startPageNum?: number;
  }): Promise<StartQueryReturn> => {
    if (startPageNum == undefined) {
      // Default to the first page.
      startPageNum = 1;
    }

    // Perform the query.
    return {
      query: query,
      options: {
        orderings: orderings,
        resultsPerPage: resultsPerPage,
        pageNum: startPageNum,
      },
      result: await queryImages(query, orderings, resultsPerPage, startPageNum),
    };
  }
);

/**
 * Action creator that loads a new page of results from the current query.
 */
export const thunkContinueQuery = createAsyncThunk(
  "thumbnailGrid/continueQuery",
  async (pageNum: number, { getState }): Promise<ContinueQueryReturn> => {
    const state = (getState() as RootState).imageView;
    const options = state.currentQueryOptions;

    // Perform the query.
    return {
      pageNum: pageNum,
      result: await queryImages(
        state.currentQuery,
        options.orderings,
        options.resultsPerPage,
        pageNum
      ),
    };
  },
  {
    condition: (pageNum: number, { getState }): boolean => {
      const state = (getState() as RootState).imageView;
      // If there is no current query, we can't continue it. Also, if we
      // have already loaded this page, or if there are no more pages,
      // it would be pointless to continue loading.
      return (
        state.currentQuery.length > 0 &&
        state.currentQueryHasMorePages &&
        pageNum > (state.currentQueryOptions.pageNum as number)
      );
    },
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
  },
  {
    condition: (imageId: string, { getState }): boolean => {
      const imageEntity = thumbnailGridSelectors.selectById(
        getState() as RootState,
        imageId
      ) as ImageEntity;
      // If the thumbnail is already loaded, we don't need to re-load it.
      return imageEntity.thumbnailStatus == ImageStatus.NOT_LOADED;
    },
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
  },
  {
    condition: (imageId: string, { getState }): boolean => {
      const imageEntity = thumbnailGridSelectors.selectById(
        getState() as RootState,
        imageId
      ) as ImageEntity;
      // If the image is already loaded, we don't need to re-load it.
      return imageEntity.imageStatus == ImageStatus.NOT_LOADED;
    },
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
  },
  {
    condition: (imageIds: string[], { getState }): boolean => {
      const state = getState() as RootState;
      return !imageIds.every((id) => {
        const imageEntity = thumbnailGridSelectors.selectById(
          state,
          id
        ) as ImageEntity;
        return imageEntity.metadataStatus != ImageStatus.NOT_LOADED;
      });
    },
  }
);

/**
 * Action creator that downloads a zip file of all currently-selected images.
 */
export const thunkBulkDownloadSelected = createAsyncThunk(
  "thumbnailGrid/bulkDownloadSelected",
  async (_, { getState, dispatch }): Promise<void> => {
    // Determine which images are selected.
    const state = getState() as RootState;
    const selectedIds = thumbnailGridSelectors
      .selectIds(state)
      .filter((id) => thumbnailGridSelectors.selectById(state, id)?.isSelected);
    const selectedImageInfo = selectedIds.map((id) => {
      const entity = thumbnailGridSelectors.selectById(state, id);
      return {
        id: entity?.backendId as ObjectRef,
        metadata: entity?.metadata as UavImageMetadata,
      };
    });

    // Start the download.
    await downloadImageZip(selectedImageInfo);

    // When the download is finished, clear the selected images.
    dispatch(
      thumbnailGridSlice.actions.selectImages({
        imageIds: selectedIds,
        select: false,
      })
    );
  },
  {
    condition: (_, { getState }): boolean => {
      const state = getState() as RootState;
      // Don't allow it to run multiple bulk downloads at once.
      return state.imageView.bulkDownloadState != RequestState.LOADING;
    },
  }
);

/**
 * Action creator that starts a new request to delete the selected images.
 */
export const thunkDeleteSelected = createAsyncThunk(
  "thumbnailGrid/deleteImages",
  async (_, { getState }): Promise<string[]> => {
    // Get the backend IDs for the images.
    const state = getState() as RootState;
    const selectedIds = thumbnailGridSelectors
      .selectIds(state)
      .filter((id) => thumbnailGridSelectors.selectById(state, id)?.isSelected);
    const backendIds = selectedIds.map(
      (id) =>
        thumbnailGridSelectors.selectById(state, id)?.backendId as ObjectRef
    );

    // Delete all the images.
    await deleteImages(backendIds);

    return selectedIds as string[];
  }
);

/**
 * Action creator that starts a new autocomplete request.
 */
export const thunkDoAutocomplete = createAsyncThunk(
  "thumbnailGrid/doAutocomplete",
  async ({
    searchString,
    numSuggestions,
  }: {
    searchString: string;
    numSuggestions: number;
  }): Promise<DoAutocompleteReturn> => {
    // Query the backend for autocomplete suggestions.
    const suggestions = await requestAutocomplete(searchString, numSuggestions);
    return { searchString: searchString, autocompleteSuggestions: suggestions };
  }
);

/** Action creator that performs a new text search.
 * @param {string} searchString The search string that the user entered.
 * @return {ThunkResult} Does not actually return anything, because it
 *  simply dispatches other actions.
 */
export function thunkTextSearch(searchString: string): ThunkResult<void> {
  return (dispatch) => {
    // Determine the query to use for searching.
    const queries = queriesFromSearchString(searchString);
    // Set the new query.
    dispatch(
      thunkStartNewQuery({
        query: queries,
        orderings: [{ field: Field.CAPTURE_DATE, ascending: false }],
      })
    );
  };
}

/**
 * Thunk for clearing a loaded full-sized image. It will
 * handle releasing the memory.
 * @param {string} imageId The entity ID of the image to clear. If not
 *  provided, it will do nothing.
 * @return {ThunkResult} Does not actually return anything, because it
 *  simply dispatches other actions.
 */
export function thunkClearFullSizedImage(imageId?: string): ThunkResult<void> {
  return (dispatch, getState) => {
    if (!imageId) {
      // Do nothing.
      return;
    }

    // Release the loaded image.
    const state: RootState = getState();
    const entity = thumbnailGridSelectors.selectById(
      state,
      imageId
    ) as ImageEntity;
    if (entity.imageUrl) {
      URL.revokeObjectURL(entity.imageUrl);
    }

    // Update the state.
    dispatch(thumbnailGridSlice.actions.clearFullSizedImage(imageId));
  };
}

/**
 * Thunk for selecting/deselecting all the images at once.
 * @param {boolean} select Whether to select or deselect.
 * @return {ThunkResult} Does not actually return anything, because it
 *  simply dispatches other actions.
 */
export function thunkSelectAll(select: boolean): ThunkResult<void> {
  return (dispatch, getState) => {
    // Get all the images.
    const imageIds = thumbnailGridSelectors.selectIds(getState());
    dispatch(selectImages({ imageIds: imageIds, select: select }));
  };
}

/**
 * Thunk that handles displaying the details view for an image. It handles
 * all the tasks including registering the image in the state (if needed),
 * and loading the image and metadata.
 * @param {ObjectRef} backendId The ID of the image on the backend.
 * @return {ThunkResult} Does not actually return anything, because it
 *  simply dispatches other actions.
 */
export function thunkShowDetails(backendId: ObjectRef): ThunkResult<void> {
  return (dispatch, getState) => {
    const state = getState();

    // Check if the image is registered in the state.
    const frontendId = createImageEntityId(backendId);
    if (thumbnailGridSelectors.selectById(state, frontendId) == undefined) {
      // We need to register it.
      dispatch(addArtifact(backendId));
    }

    // Mark this as the image displayed on the details page.
    dispatch(showDetails(frontendId));
  };
}

/**
 * Common reducer logic for updating the state after a query completes.
 * @param {Draft<ImageViewState>} state The state to update.
 * @param {QueryResponse} queryResults The results from the query.
 */
function updateQueryState(
  state: Draft<ImageViewState>,
  queryResults: QueryResponse
) {
  // Register all the results.
  thumbnailGridAdapter.addMany(
    state,
    queryResults.imageIds.map((i) => createDefaultEntity(i))
  );

  // Save the current query.
  state.currentQueryState = RequestState.SUCCEEDED;
  state.currentQueryHasMorePages = !queryResults.isLastPage;
}

export const thumbnailGridSlice = createSlice({
  name: "thumbnailGrid",
  initialState: initialState as ImageViewState,
  reducers: {
    // We are manually adding a new artifact to the frontend state.
    addArtifact(state, action) {
      thumbnailGridAdapter.addOne(state, createDefaultEntity(action.payload));
    },
    // Clears a loaded full-sized image.
    clearFullSizedImage(state, action) {
      thumbnailGridAdapter.updateOne(state, {
        id: action.payload,
        changes: { imageUrl: null, imageStatus: ImageStatus.NOT_LOADED },
      });
    },
    // Completely resets the current image view, removing all loaded images.
    clearImageView(state, _) {
      thumbnailGridAdapter.removeAll(state);

      // Reset the query state.
      state.currentQuery = [];
      state.currentQueryOptions = {};
      state.currentQueryState = RequestState.IDLE;
      state.metadataLoadingState = RequestState.IDLE;
      state.currentQueryError = null;
      state.currentQueryHasMorePages = true;
    },
    // Removes any current autocomplete suggestions.
    clearAutocomplete(state, _) {
      state.search.searchString = "";
      state.search.autocompleteSuggestions = {
        menu: AutocompleteMenu.NONE,
        textCompletions: [],
      };
      state.search.queryState = RequestState.IDLE;
    },
    // Selects or deselects images.
    selectImages(state, action) {
      const imageIds = action.payload.imageIds;

      // Filter out updates that won't actually change anything.
      const updateIds = [];
      for (const id of imageIds) {
        const entity = state.entities[id] as ImageEntity;
        if (entity.isSelected != action.payload.select) {
          updateIds.push(id);
        }
      }

      const updates = updateIds.map((id: string) => ({
        id: id,
        changes: { isSelected: action.payload.select },
      }));
      thumbnailGridAdapter.updateMany(state, updates);

      // Update the number of selected items.
      if (action.payload.select) {
        state.numItemsSelected += updateIds.length;
      } else {
        state.numItemsSelected -= updateIds.length;
      }
    },
    // Marks an image as the one being displayed on the details page.
    showDetails(state, action) {
      state.details.frontendId = action.payload;
    },
  },
  extraReducers: (builder) => {
    // We initiated a new query for home screen data.
    builder.addCase(thunkStartNewQuery.pending, (state) => {
      // Remove the current images, which will now be out-of-date.
      thumbnailGridAdapter.removeAll(state);

      state.currentQueryState = RequestState.LOADING;
    });

    // Adds (possibly partial) results from a query.
    builder.addCase(thunkStartNewQuery.fulfilled, (state, action) => {
      updateQueryState(state, action.payload.result);

      // Save the current query.
      state.currentQuery = action.payload.query;
      state.currentQueryOptions = action.payload.options;
    });

    // We continued a query for home screen data.
    builder.addCase(thunkContinueQuery.pending, (state) => {
      state.currentQueryState = RequestState.LOADING;
    });

    // Adds additional results from a query.
    builder.addCase(thunkContinueQuery.fulfilled, (state, action) => {
      updateQueryState(state, action.payload.result);

      // Keep the current page number up-to-date.
      state.currentQueryOptions.pageNum = action.payload.pageNum;
    });

    // We initiated a bulk download.
    builder.addCase(thunkBulkDownloadSelected.pending, (state) => {
      state.bulkDownloadState = RequestState.LOADING;
    });

    // We completed a bulk download.
    builder.addCase(thunkBulkDownloadSelected.fulfilled, (state) => {
      state.bulkDownloadState = RequestState.SUCCEEDED;
    });

    // We initiated a new autocomplete query.
    builder.addCase(thunkDoAutocomplete.pending, (state, action) => {
      state.search.queryState = RequestState.LOADING;
      state.search.searchString = action.meta.arg.searchString;
    });

    // We completed an autocomplete query and have suggestions.
    builder.addCase(thunkDoAutocomplete.fulfilled, (state, action) => {
      // Add the results to the state.
      state.search.queryState = RequestState.SUCCEEDED;
      state.search.autocompleteSuggestions =
        action.payload.autocompleteSuggestions;
    });

    // We initiated thumbnail loading.
    builder.addCase(thunkLoadThumbnail.pending, (state, action) => {
      thumbnailGridAdapter.updateOne(state, {
        id: action.meta.arg,
        changes: {
          thumbnailStatus: ImageStatus.LOADING,
        },
      });
    });

    // Add results from thumbnail loading.
    builder.addCase(thunkLoadThumbnail.fulfilled, (state, action) => {
      // Transition images from LOADING to VISIBLE, and save the image URL.
      thumbnailGridAdapter.updateOne(state, {
        id: action.payload.imageId,
        changes: {
          thumbnailStatus: ImageStatus.LOADED,
          thumbnailUrl: action.payload.imageUrl,
        },
      });
    });

    // We initiated image loading.
    builder.addCase(thunkLoadImage.pending, (state, action) => {
      thumbnailGridAdapter.updateOne(state, {
        id: action.meta.arg,
        changes: {
          imageStatus: ImageStatus.LOADING,
        },
      });
    });

    // Add results from image loading.
    builder.addCase(thunkLoadImage.fulfilled, (state, action) => {
      // Transition images from LOADING to VISIBLE, and save the image URL.
      thumbnailGridAdapter.updateOne(state, {
        id: action.payload.imageId,
        changes: {
          imageStatus: ImageStatus.LOADED,
          imageUrl: action.payload.imageUrl,
        },
      });
    });

    // We initiated image deletion.
    builder.addCase(thunkDeleteSelected.pending, (state, _) => {
      state.imageDeletionState = RequestState.LOADING;
    });

    // We finished deleting images.
    builder.addCase(thunkDeleteSelected.fulfilled, (state, action) => {
      state.imageDeletionState = RequestState.SUCCEEDED;
      // Remove the deleted images from the frontend state.
      thumbnailGridAdapter.removeMany(state, action.payload);

      // Since we deleted all the selected items, there are no items selected.
      state.numItemsSelected = 0;
    });

    // We initiated a new request for metadata.
    builder.addCase(thunkLoadMetadata.pending, (state, action) => {
      state.metadataLoadingState = RequestState.LOADING;

      const updates = action.meta.arg.map((imageId: string) => ({
        id: imageId,
        changes: { metadataStatus: ImageStatus.LOADING },
      }));
      thumbnailGridAdapter.updateMany(state, updates);
    });

    // Add results from metadata loading.
    builder.addCase(thunkLoadMetadata.fulfilled, (state, action) => {
      state.metadataLoadingState = RequestState.SUCCEEDED;

      // Save the image metadata.
      const updates = action.payload.imageIds.map(
        (imageId: string, index: number) => {
          // Get corresponding metadata.
          const metadata = action.payload.metadata[index];
          return {
            id: imageId,
            changes: { metadata: metadata, metadataStatus: ImageStatus.LOADED },
          };
        }
      );

      thumbnailGridAdapter.updateMany(state, updates);
    });
  },
});

export const {
  clearFullSizedImage,
  addArtifact,
  clearImageView,
  clearAutocomplete,
  selectImages,
  showDetails,
} = thumbnailGridSlice.actions;
export default thumbnailGridSlice.reducer;
