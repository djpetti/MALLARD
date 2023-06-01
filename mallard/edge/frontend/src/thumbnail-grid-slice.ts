import {
  AnyAction,
  createAsyncThunk,
  createEntityAdapter,
  createSlice,
  Draft,
  EntityId,
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
  DEFAULT_ORDERINGS,
  deleteImages,
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
} from "mallard-api";
import { ThunkAction } from "redux-thunk";
import {
  AutocompleteMenu,
  queriesFromSearchString,
  requestAutocomplete,
  Suggestions,
} from "./autocomplete";
import { downloadImageZip, makeImageUrlList } from "./downloads";
import { chunk } from "lodash";

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
type ThunkResult<R> = ThunkAction<R, RootState, any, AnyAction>;

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
  numThumbnailsLoaded: 0,
  bulkDownloadState: RequestState.IDLE,
  exportedImagesUrl: null,
  collapsedSections: {},
});

/** Memoized selectors for the state. */
export const thumbnailGridSelectors =
  thumbnailGridAdapter.getSelectors<RootState>((state) => state.imageView);

/**
 * Action creator that starts a new request for thumbnails on the homepage.
 */
export const thunkStartNewQuery = createAsyncThunk(
  "thumbnailGrid/startNewQuery",
  async (
    {
      query,
      orderings = DEFAULT_ORDERINGS,
      resultsPerPage,
      startPageNum,
    }: {
      query: ImageQuery[];
      orderings?: Ordering[];
      resultsPerPage?: number;
      startPageNum?: number;
    },
    { dispatch }
  ): Promise<StartQueryReturn> => {
    if (startPageNum == undefined) {
      // Default to the first page.
      startPageNum = 1;
    }

    // Perform the query.
    const queryResult = await queryImages(
      query,
      orderings,
      resultsPerPage,
      startPageNum
    );

    // Add the results to the state.
    dispatch(addArtifacts(queryResult.imageIds));
    // Fetch all the metadata.
    dispatch(
      thunkLoadMetadata(queryResult.imageIds.map((i) => createImageEntityId(i)))
    );

    return {
      query: query,
      options: {
        orderings: orderings,
        resultsPerPage: resultsPerPage,
        pageNum: startPageNum,
      },
      result: queryResult,
    };
  }
);

/**
 * Action creator that loads a new page of results from the current query.
 */
export const thunkContinueQuery = createAsyncThunk(
  "thumbnailGrid/continueQuery",
  async (
    pageNum: number,
    { getState, dispatch }
  ): Promise<ContinueQueryReturn> => {
    const state = (getState() as RootState).imageView;
    const options = state.currentQueryOptions;

    // Perform the query.
    const queryResult = await queryImages(
      state.currentQuery,
      options.orderings,
      options.resultsPerPage,
      pageNum
    );

    // Add the results to the state.
    dispatch(addArtifacts(queryResult.imageIds));
    // Fetch all the metadata.
    dispatch(
      thunkLoadMetadata(queryResult.imageIds.map((i) => createImageEntityId(i)))
    );

    return {
      pageNum: pageNum,
      result: queryResult,
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
 * Action creator that starts new requests for a set of image thumbnails. It
 * will not update the state until ALL requests have finished.
 */
const thunkLoadThumbnailsChunk = createAsyncThunk(
  "thumbnailGrid/loadThumbnailsChunk",
  async (imageIds: string[], { getState }): Promise<LoadImageReturn[]> => {
    const promises: Promise<Blob>[] = [];
    const filteredIds: string[] = [];
    for (const imageId of imageIds) {
      // This should never be undefined, because that means our image ID is invalid.
      const imageEntity: ImageEntity = thumbnailGridSelectors.selectById(
        getState() as RootState,
        imageId
      ) as ImageEntity;
      if (imageEntity.thumbnailStatus === ImageStatus.LOADED) {
        // If the image is already loaded, don't reload it.
        continue;
      }

      promises.push(loadThumbnail(imageEntity.backendId));
      filteredIds.push(imageId);
    }

    // Start thumbnail loading.
    const thumbnails = await Promise.all(promises);
    // Get the object URL for all thumbnails.
    return filteredIds.map((id, i) => ({
      imageId: id,
      imageUrl: URL.createObjectURL(thumbnails[i]),
    }));
  },
  {
    condition: (imageIds: string[], { getState }): boolean => {
      const state = getState() as RootState;
      return !imageIds.every((id) => {
        const imageEntity = thumbnailGridSelectors.selectById(
          state,
          id
        ) as ImageEntity;
        return imageEntity.thumbnailStatus != ImageStatus.NOT_LOADED;
      });
    },
  }
);

/**
 * Chunk size to use for loading thumbnails.
 */
const THUMBNAIL_CHUNK_SIZE: number = 50;

/**
 * Action creator that starts new requests for a set of image thumbnails. It
 * will break the thumbnail loading into chunks and update the state after
 * each chunk finishes, to keep things more responsive.
 * @param {string[]} imageIds The IDs of the images that we want to load
 *  thumbnails for.
 * @param {number} chunkSize Specify the size of the chunks to use when
 *  splitting the thumbnail load operation.
 * @return {ThunkResult} Does not actually return anything, because it
 *  simply dispatches other actions.
 */
export function thunkLoadThumbnails(
  imageIds: string[],
  chunkSize: number = THUMBNAIL_CHUNK_SIZE
): ThunkResult<void> {
  return (dispatch) => {
    // Break requested thumbnails up into chunks.
    for (const chunkIds of chunk(imageIds, chunkSize)) {
      dispatch(thunkLoadThumbnailsChunk(chunkIds));
    }
  };
}

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
    const imageEntities: ImageEntity[] = imageIds.map(
      (imageId: string) =>
        // This should never be undefined, because that means our image ID is invalid.
        thumbnailGridSelectors.selectById(
          getState() as RootState,
          imageId
        ) as ImageEntity
    );
    // Check for image entities that don't have loaded metadata.
    const entitiesToLoad = imageEntities.filter(
      (entity) => entity.metadata === null
    );
    const loadedEntities = imageEntities.filter(
      (entity) => entity.metadata !== null
    );
    const backendIds: ObjectRef[] = entitiesToLoad.map(
      (entity) => entity.backendId
    );

    const metadata: UavImageMetadata[] = await getMetadata(backendIds);

    // We have to reconstruct the image IDs because we changed the order
    // during filtering.
    const previouslyLoadedImageIds = loadedEntities.map((entity) =>
      createImageEntityId(entity.backendId)
    );
    const newlyLoadedImageIds = backendIds.map(createImageEntityId);
    const previousMetadata = loadedEntities.map(
      (entity) => entity.metadata as UavImageMetadata
    );
    return {
      imageIds: previouslyLoadedImageIds.concat(newlyLoadedImageIds),
      metadata: previousMetadata.concat(metadata),
    };
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
 * Helper that gets images from the state that are currently selected.
 * @param {RootState} state The current state.
 * @return {EntityId[]} The frontend IDs of the selected images.
 */
function getSelectedImageIds(state: RootState): EntityId[] {
  return thumbnailGridSelectors
    .selectIds(state)
    .filter((id) => thumbnailGridSelectors.selectById(state, id)?.isSelected);
}

/**
 * Action creator that downloads a zip file of all currently-selected images.
 */
export const thunkBulkDownloadSelected = createAsyncThunk(
  "thumbnailGrid/bulkDownloadSelected",
  async (_, { getState, dispatch }): Promise<void> => {
    // Determine which images are selected.
    const state = getState() as RootState;
    const selectedIds = getSelectedImageIds(state);
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
  "thumbnailGrid/deleteSelected",
  async (_, { dispatch, getState }): Promise<string[]> => {
    // Get the backend IDs for the images.
    const state = getState() as RootState;
    const selectedIds = getSelectedImageIds(state);
    const backendIds = selectedIds.map(
      (id) =>
        thumbnailGridSelectors.selectById(state, id)?.backendId as ObjectRef
    );

    // Delete all the images.
    await deleteImages(backendIds);

    // TODO (danielp): Look into this typing issue further. It might be
    //  a bug in redux-thunk.
    type ActionType = ThunkAction<void, unknown, unknown, AnyAction>;
    // Release the associated memory.
    dispatch(thunkClearEntities(selectedIds) as ActionType);

    return selectedIds as string[];
  }
);

/**
 * Action creator that exports the selected image URLs.
 * @return {ThunkResult} Does not actually return anything, because it
 *  simply dispatches other actions.
 */
export function thunkExportSelected(): ThunkResult<void> {
  return (dispatch, getState) => {
    // Get the backend IDs for the images.
    const state = getState();
    const selectedIds = getSelectedImageIds(state);
    const backendIds = selectedIds.map(
      (id) =>
        thumbnailGridSelectors.selectById(state, id)?.backendId as ObjectRef
    );

    // Create the list of URLs.
    const listUrl = makeImageUrlList(backendIds);

    // Set it in the state.
    dispatch(setExportedImagesUrl(listUrl));
    // Deselect all the images.
    dispatch(thunkSelectAll(false));
  };
}

/**
 * Action creator that revokes the URL for the exported image list.
 * @return {ThunkResult} Does not actually return anything, because it
 * simply dispatches other actions.
 */
export function thunkClearExportedImages(): ThunkResult<void> {
  return (dispatch, getState) => {
    // Revoke the URL.
    const state = getState();
    if (state.imageView.exportedImagesUrl !== null) {
      URL.revokeObjectURL(state.imageView.exportedImagesUrl);

      // Clear it in the state.
      dispatch(setExportedImagesUrl(null));
    }
  };
}

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

/**
 * Action creator that performs a new text search.
 * @param {string} searchString The search string that the user entered.
 * @return {ThunkResult} Does not actually return anything, because it
 *  simply dispatches other actions.
 */
export function thunkTextSearch(searchString: string): ThunkResult<void> {
  return (dispatch) => {
    // Clear the current image view to release memory.
    dispatch(thunkClearImageView());

    // Determine the query to use for searching.
    const queries = queriesFromSearchString(searchString);
    // Set the new query.
    dispatch(
      thunkStartNewQuery({
        query: queries,
      })
    );
  };
}

/**
 * Thunk for clearing loaded full-sized images. It will
 * handle releasing the memory.
 * @param {(EntityId | undefined)[]} imageIds The entity IDs of the images to
 *  clear.
 * @return {ThunkResult} Does not actually return anything, because it
 *  simply dispatches other actions.
 */
export function thunkClearFullSizedImages(
  imageIds: (EntityId | undefined)[]
): ThunkResult<void> {
  return (dispatch, getState) => {
    const state: RootState = getState();

    const clearedImageIds = [];
    for (const imageId of imageIds) {
      if (!imageId) {
        // Do nothing.
        continue;
      }

      // Release the loaded image.
      const entity = thumbnailGridSelectors.selectById(
        state,
        imageId
      ) as ImageEntity;
      if (entity.imageUrl) {
        URL.revokeObjectURL(entity.imageUrl);
        clearedImageIds.push(imageId);
      }
    }

    // Update the state.
    dispatch(clearFullSizedImages(clearedImageIds));
  };
}

/**
 * Thunk for clearing loaded thumbnail images. It will handle releasing the
 * memory.
 * @param {(EntityId | undefined)[]} imageIds The entity IDs of the image to
 *  clear.
 * @return {ThunkResult} Does not actually return anything, because it
 *  simply dispatches other actions.
 */
export function thunkClearThumbnails(
  imageIds: (EntityId | undefined)[]
): ThunkResult<void> {
  return (dispatch, getState) => {
    const state: RootState = getState();

    const clearedImageIds = [];
    for (const imageId of imageIds) {
      if (!imageId) {
        // Do nothing.
        continue;
      }

      // Release the loaded image.
      const entity = thumbnailGridSelectors.selectById(
        state,
        imageId
      ) as ImageEntity;
      if (entity.thumbnailUrl) {
        URL.revokeObjectURL(entity.thumbnailUrl);
        clearedImageIds.push(imageId);
      }
    }

    // Update the state.
    dispatch(clearThumbnails(clearedImageIds));
  };
}

/**
 * Removes any loaded images or thumbnails for these entities,
 * significantly reducing memory usage.
 * @param {EntityId[]} imageIds The IDs of the entities to remove.
 * @return {ThunkResult} Does not actually return anything, because it
 * simply dispatches other actions.
 */
export function thunkClearEntities(imageIds: EntityId[]): ThunkResult<void> {
  return (dispatch) => {
    // Free the associated memory.
    dispatch(thunkClearFullSizedImages(imageIds));
    dispatch(thunkClearThumbnails(imageIds));
  };
}

/**
 * Thunk for clearing the entire image view state. It will handle releasing
 * the memory.
 * @return {ThunkResult} Does not actually return anything, because it
 * simply dispatches other actions.
 */
export function thunkClearImageView(): ThunkResult<void> {
  return (dispatch, getState) => {
    // Free all the memory associated with the images.
    const imageIds = thumbnailGridSelectors.selectIds(getState());
    dispatch(thunkClearThumbnails(imageIds));
    dispatch(thunkClearFullSizedImages(imageIds));

    // Update the state.
    dispatch(clearImageView({ preserveQuery: true }));
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
    dispatch(thunkSelectImages({ imageIds: imageIds, select: select }));
  };
}

/**
 * Thunk for selecting/deselecting multiple images.
 * @param {EntityId[]} imageIds The image IDs to select or deselect.
 * @param {boolean} select True to select, false to deselect.
 * @return {ThunkResult} Does not actually return anything, because it
 *  simply dispatches other actions.
 */
export function thunkSelectImages({
  imageIds,
  select,
}: {
  imageIds: EntityId[];
  select: boolean;
}): ThunkResult<void> {
  return (dispatch, getState) => {
    const state = getState().imageView;

    // Filter out updates that won't actually change anything. This can help
    // us avoid dispatching spurious actions, which are expensive.
    const updateIds = [];
    for (const id of imageIds) {
      const entity = state.entities[id] as ImageEntity;
      if (entity.isSelected != select) {
        updateIds.push(id);
      }
    }

    if (updateIds.length > 0) {
      dispatch(selectImages({ imageIds: updateIds, select: select }));
    }
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
      dispatch(addArtifacts([backendId]));
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
  // Save the current query.
  state.currentQueryState = RequestState.SUCCEEDED;
  state.currentQueryHasMorePages = !queryResults.isLastPage;
}

export const thumbnailGridSlice = createSlice({
  name: "thumbnailGrid",
  initialState: initialState as ImageViewState,
  reducers: {
    // We are manually adding a new artifact to the frontend state.
    addArtifacts(state, action) {
      thumbnailGridAdapter.upsertMany(
        state,
        action.payload.map((backendId: ObjectRef) =>
          createDefaultEntity(backendId)
        )
      );
    },
    // Clears a loaded full-sized image.
    clearFullSizedImages(state, action) {
      thumbnailGridAdapter.updateMany(
        state,
        action.payload.map((id: string) => ({
          id: id,
          changes: { imageUrl: null, imageStatus: ImageStatus.NOT_LOADED },
        }))
      );
    },
    // Clears a loaded thumbnail.
    clearThumbnails(state, action) {
      thumbnailGridAdapter.updateMany(
        state,
        action.payload.map((id: string) => ({
          id: id,
          changes: {
            thumbnailUrl: null,
            thumbnailStatus: ImageStatus.NOT_LOADED,
          },
        }))
      );

      // Since we check in the action creator, it's safe to assume that
      // every update constitutes an actual change.
      state.numThumbnailsLoaded -= action.payload.length;
    },
    // Completely resets the current image view, removing all loaded images.
    clearImageView(state, action) {
      thumbnailGridAdapter.removeAll(state);

      if (action.payload.preserveQuery) {
        // Keep the current query, but reset the page number since we're
        // clearing all the loaded artifacts.
        state.currentQueryOptions.pageNum = 0;
      }
      if (!action.payload.preserveQuery) {
        // Reset the query state.
        state.currentQuery = [];
        state.currentQueryOptions = {};
      }
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

      const updates = imageIds.map((id: string) => ({
        id: id,
        changes: { isSelected: action.payload.select },
      }));
      thumbnailGridAdapter.updateMany(state, updates);

      // Update the number of selected items.
      if (action.payload.select) {
        state.numItemsSelected += imageIds.length;
      } else {
        state.numItemsSelected -= imageIds.length;
      }
    },
    // Marks an image as the one being displayed on the details page.
    showDetails(state, action) {
      state.details.frontendId = action.payload;
    },
    // Sets the URL for the exported image list.
    setExportedImagesUrl(state, action) {
      state.exportedImagesUrl = action.payload;
    },
    // Sets a new section as expanded or collapsed.
    setSectionExpanded(state, action) {
      state.collapsedSections[action.payload.sectionName] =
        !action.payload.expand;
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
    builder.addCase(thunkLoadThumbnailsChunk.pending, (state, action) => {
      const updates = action.meta.arg.map((id) => ({
        id: id,
        changes: {
          thumbnailStatus: ImageStatus.LOADING,
        },
      }));
      thumbnailGridAdapter.updateMany(state, updates);
    });

    // Add results from thumbnail loading.
    builder.addCase(thunkLoadThumbnailsChunk.fulfilled, (state, action) => {
      // We indiscriminately change the status of all the specified
      // thumbnails to LOADING, so we need to change them all to loaded.
      thumbnailGridAdapter.updateMany(
        state,
        action.meta.arg.map((id) => ({
          id: id,
          changes: { thumbnailStatus: ImageStatus.LOADED },
        }))
      );

      // Save the image URLs.
      const updates = action.payload.map((p) => ({
        id: p.imageId,
        changes: {
          thumbnailUrl: p.imageUrl,
        },
      }));
      thumbnailGridAdapter.updateMany(state, updates);

      state.numThumbnailsLoaded += updates.length;
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
  clearFullSizedImages,
  clearThumbnails,
  addArtifacts,
  clearImageView,
  clearAutocomplete,
  selectImages,
  showDetails,
  setExportedImagesUrl,
  setSectionExpanded,
} = thumbnailGridSlice.actions;
export default thumbnailGridSlice.reducer;
