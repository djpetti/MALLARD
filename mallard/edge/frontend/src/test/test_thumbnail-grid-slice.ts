import thumbnailGridReducer, {
  setSearchString,
  clearImageView,
  createArtifactEntityId,
  selectImages,
  setEditingDialogOpen,
  setSectionExpanded,
  thumbnailGridSelectors,
  thumbnailGridSlice,
  thunkBulkDownloadSelected,
  thunkClearExportedImages,
  thunkClearFullSizedImages,
  thunkClearImageView,
  thunkClearThumbnails,
  thunkContinueQuery,
  thunkDeleteSelected,
  thunkDoAutocomplete,
  thunkExportSelected,
  thunkLoadImage,
  thunkLoadMetadata,
  thunkLoadThumbnails,
  thunkSelectAll,
  thunkSelectImages,
  thunkShowDetails,
  thunkStartNewQuery,
  thunkTextSearch,
  thunkUpdateSelectedMetadata,
  clearVideoUrl,
  thunkAddArtifacts,
  thunkSetVideoUrl,
  setScrollLocation,
} from "../thumbnail-grid-slice";
import {
  ArtifactEntity,
  ImageQuery,
  ArtifactStatus,
  ImageViewState,
  RequestState,
} from "../types";
import {
  fakeFile,
  fakeArtifactEntities,
  fakeArtifactEntity,
  fakeImageMetadata,
  fakeImageQuery,
  fakeState,
  fakeSuggestions,
  fakeTypedObjectRef,
} from "./element-test-utils";
import { ObjectType, QueryResponse, UavImageMetadata } from "mallard-api";
import each from "jest-each";
import {
  batchUpdateMetadata,
  DEFAULT_ORDERINGS,
  deleteImages,
  getArtifactUrl,
  getMetadata,
  getPreviewVideoUrl,
  getStreamableVideoUrl,
  loadImage,
  loadThumbnail,
  queryImages,
} from "../api-client";
import {
  AutocompleteMenu,
  queriesFromSearchString,
  requestAutocomplete,
  updateMenu,
} from "../autocomplete";
import { downloadArtifactZip, makeArtifactUrlList } from "../downloads";
import { faker } from "@faker-js/faker";
import { RootState, setupStore } from "../store";

// Mock out the gateway API.
jest.mock("../api-client", () => ({
  queryImages: jest.fn(),
  loadThumbnail: jest.fn(),
  loadImage: jest.fn(),
  deleteImages: jest.fn(),
  getMetadata: jest.fn(),
  batchUpdateMetadata: jest.fn(),
  getArtifactUrl: jest.fn(),
  getPreviewVideoUrl: jest.fn(),
  getStreamableVideoUrl: jest.fn(),
}));

const mockQueryImages = queryImages as jest.MockedFn<typeof queryImages>;
const mockLoadThumbnail = loadThumbnail as jest.MockedFn<typeof loadThumbnail>;
const mockLoadImage = loadImage as jest.MockedFn<typeof loadImage>;
const mockGetMetadata = getMetadata as jest.MockedFn<typeof getMetadata>;
const mockDeleteImages = deleteImages as jest.MockedFn<typeof deleteImages>;
const mockBatchUpdateMetadata = batchUpdateMetadata as jest.MockedFn<
  typeof batchUpdateMetadata
>;
const mockGetArtifactUrl = getArtifactUrl as jest.MockedFn<
  typeof getArtifactUrl
>;
const mockGetPreviewVideoUrl = getPreviewVideoUrl as jest.MockedFn<
  typeof getPreviewVideoUrl
>;
const mockGetStreamableVideoUrl = getStreamableVideoUrl as jest.MockedFn<
  typeof getStreamableVideoUrl
>;

// Mock out the autocomplete functions.
jest.mock("../autocomplete", () => {
  const realAutocomplete = jest.requireActual("../autocomplete");

  return {
    requestAutocomplete: jest.fn(),
    queriesFromSearchString: jest.fn(),
    updateMenu: jest.fn(),
    AutocompleteMenu: realAutocomplete.AutocompleteMenu,
  };
});

const mockRequestAutocomplete = requestAutocomplete as jest.MockedFn<
  typeof requestAutocomplete
>;
const mockQueriesFromSearchString = queriesFromSearchString as jest.MockedFn<
  typeof queriesFromSearchString
>;
const mockUpdateMenu = updateMenu as jest.MockedFn<typeof updateMenu>;

// Mock out the download functions.
jest.mock("../downloads", () => ({
  downloadArtifactZip: jest.fn(),
  makeArtifactUrlList: jest.fn(),
}));

const mockDownloadArtifactZip = downloadArtifactZip as jest.MockedFn<
  typeof downloadArtifactZip
>;
const mockMakeArtifactUrlList = makeArtifactUrlList as jest.MockedFn<
  typeof makeArtifactUrlList
>;

// Mock out `createObjectURL` and `revokeObjectURL`.
const mockCreateObjectUrl = jest.fn();
const mockRevokeObjectUrl = jest.fn();
global.URL.createObjectURL = mockCreateObjectUrl;
global.URL.revokeObjectURL = mockRevokeObjectUrl;

describe("thumbnail-grid-slice action creators", () => {
  beforeEach(() => {
    // Set the faker seed.
    faker.seed(1337);

    // Reset mocks.
    jest.clearAllMocks();
  });

  it("creates an addArtifacts action", async () => {
    // Arrange.
    // Make it look like we can get URLs for the previews and streamable videos.
    const previewUrl = faker.internet.url();
    const streamableUrl = faker.internet.url();
    mockGetPreviewVideoUrl.mockResolvedValue(previewUrl);
    mockGetStreamableVideoUrl.mockResolvedValue(streamableUrl);

    const backendIds = [fakeTypedObjectRef(), fakeTypedObjectRef()];

    // Act.
    const state = fakeState();
    const store = setupStore(state);
    const addArtifactsPromise = thunkAddArtifacts(backendIds)(
      store.dispatch,
      store.getState,
      {}
    );

    // Assert.
    let newState = store.getState().imageView;

    // It should have added new entities as part of the pending action.
    expect(newState.ids.length).toEqual(2);
    for (let i = 0; i < newState.ids.length; ++i) {
      expect(newState.entities[newState.ids[i]]?.backendId).toEqual(
        backendIds[i]
      );
      expect(newState.ids[i]).toEqual(createArtifactEntityId(backendIds[i].id));

      // It should have set the preview and streamable URLs to null.
      expect(newState.entities[newState.ids[i]]?.previewUrl).toBeNull();
      expect(newState.entities[newState.ids[i]]?.streamableUrl).toBeNull();
    }

    // Act.
    await addArtifactsPromise;

    // Assert.
    newState = store.getState().imageView;

    // It should have gotten the URLs.
    expect(mockGetPreviewVideoUrl).toBeCalledTimes(2);
    expect(mockGetStreamableVideoUrl).toBeCalledTimes(2);

    // It should have updated the entity.
    expect(newState.ids).toHaveLength(2);
    for (const frontendId of newState.ids) {
      // It should have set the preview and streamable URLs.
      expect(newState.entities[frontendId]?.previewUrl).toEqual(previewUrl);
      expect(newState.entities[frontendId]?.streamableUrl).toEqual(
        streamableUrl
      );
    }
  });

  it("creates a setVideoUrl action", async () => {
    // Arrange.
    const url = faker.internet.url();

    const state = fakeState();
    const entity = fakeArtifactEntity();
    entity.backendId.type = ObjectType.VIDEO;
    const id = createArtifactEntityId(entity.backendId.id);
    state.imageView.ids = [id];
    state.imageView.entities[id] = entity;

    // Make it look like it can get the artifact url.
    mockGetArtifactUrl.mockResolvedValue(url);

    const store = setupStore(state);

    // Act.
    await thunkSetVideoUrl(id)(store.dispatch, store.getState, {});

    // Assert.
    // It should have gotten the URL.
    expect(mockGetArtifactUrl).toBeCalledTimes(1);

    // Assert.
    // It should have updated the state.
    const newImageState = store.getState().imageView;
    expect(newImageState.entities[id]?.artifactUrl).toEqual(url);
  });

  it("does not create a setVideoUrl action for non-videos", async () => {
    // Arrange.
    const state = fakeState();
    const entity = fakeArtifactEntity();
    entity.backendId.type = ObjectType.IMAGE;
    const id = createArtifactEntityId(entity.backendId.id);
    state.imageView.ids = [id];
    state.imageView.entities[id] = entity;

    const store = setupStore(state);

    // Act.
    await thunkSetVideoUrl(id)(store.dispatch, store.getState, {});

    // Assert.
    // It should have done nothing.
    expect(mockGetArtifactUrl).not.toHaveBeenCalled();

    const newState = store.getState().imageView;
    expect(newState.entities[id]?.artifactUrl).toEqual(
      state.imageView.entities[id]?.artifactUrl
    );
  });

  each([
    ["no start page", undefined],
    ["start page", faker.datatype.number()],
  ]).it(
    "creates a startNewQuery action with %s",
    async (_: string, startPage?: number) => {
      // Arrange.
      // Make it look like the query request succeeds.
      const queryResult: QueryResponse = {
        imageIds: [fakeTypedObjectRef(), fakeTypedObjectRef()],
        pageNum: startPage ?? 1,
        isLastPage: true,
      };
      mockQueryImages.mockResolvedValue(queryResult);

      const state = fakeState();
      state.imageView.currentQueryState = RequestState.IDLE;

      const store = setupStore(state);

      // Fake query to perform.
      const queries: ImageQuery[] = [{}];
      const orderings = DEFAULT_ORDERINGS;
      const resultsPerPage = faker.datatype.number({ min: 1 });

      // Set up fake metadata.
      const fakeMetadata = fakeImageMetadata();
      mockGetMetadata.mockResolvedValue([fakeMetadata, fakeMetadata]);

      // Act.
      const startQueryPromise = thunkStartNewQuery({
        query: queries,
        orderings,
        resultsPerPage,
        startPageNum: startPage,
      })(store.dispatch, store.getState, {});

      // Assert.
      let newState = store.getState();
      // It should have marked the query request as loading.
      expect(newState.imageView.currentQueryState).toEqual(
        RequestState.LOADING
      );
      // It should have cleared the image view state.
      expect(newState.imageView.ids).toHaveLength(0);

      // Act.
      await startQueryPromise;

      // Assert.
      // It should have started the query.
      expect(mockQueryImages).toBeCalledTimes(1);

      newState = store.getState();
      // It should have marked the query as succeeded.
      expect(newState.imageView.currentQueryState).toEqual(
        RequestState.SUCCEEDED
      );

      // The query should have been preserved so that we can re-run it.
      expect(newState.imageView.currentQuery).toEqual(queries);
      expect(newState.imageView.currentQueryOptions).toEqual({
        orderings,
        resultsPerPage,
        pageNum: startPage ?? 1,
      });

      // It should have loaded metadata for all of them.
      expect(mockGetMetadata).toBeCalledWith(queryResult.imageIds);
      expect(newState.imageView.metadataLoadingState).toEqual(
        RequestState.SUCCEEDED
      );

      for (const backendId of queryResult.imageIds) {
        // It should have added the query results to the state.
        const frontendId = createArtifactEntityId(backendId.id);
        expect(newState.imageView.ids).toContain(frontendId);
        // It should have set the metadata.
        expect(newState.imageView.entities[frontendId].metadata).toEqual(
          fakeMetadata
        );
      }
    }
  );

  it("creates a continueQuery action", async () => {
    // Arrange.
    // Set up the state so that it looks like we have an existing query.
    const query: ImageQuery = {};
    const state = fakeState();
    const pageNum = faker.datatype.number();
    state.imageView.currentQuery = [query];
    state.imageView.currentQueryHasMorePages = true;
    state.imageView.currentQueryOptions.pageNum = pageNum;
    // The state will probably be SUCCEEDED in practice since we have
    // run another query before.
    state.imageView.currentQueryState = RequestState.SUCCEEDED;

    // Make it look like the query request succeeds.
    const queryResult: QueryResponse = {
      imageIds: [fakeTypedObjectRef(), fakeTypedObjectRef()],
      pageNum: pageNum + 1,
      isLastPage: true,
    };
    mockQueryImages.mockResolvedValue(queryResult);

    // Set up fake metadata.
    const fakeMetadata = fakeImageMetadata();
    mockGetMetadata.mockResolvedValue([fakeMetadata, fakeMetadata]);

    const store = setupStore(state);

    // Act.
    const continueQueryPromise = thunkContinueQuery(pageNum + 1)(
      store.dispatch,
      store.getState,
      {}
    );

    // Assert.
    let newState = store.getState();
    // It should have marked the query request as loading.
    expect(newState.imageView.currentQueryState).toEqual(RequestState.LOADING);

    // Act.
    await continueQueryPromise;

    // Assert.
    // It should have made the query.
    expect(mockQueryImages).toBeCalledTimes(1);
    expect(mockQueryImages).toBeCalledWith(
      state.imageView.currentQuery,
      state.imageView.currentQueryOptions.orderings,
      state.imageView.currentQueryOptions.resultsPerPage,
      pageNum + 1
    );

    newState = store.getState();
    // It should have marked the query as succeeded.
    expect(newState.imageView.currentQueryState).toEqual(
      RequestState.SUCCEEDED
    );
    // It should have updated the page number.
    expect(newState.imageView.currentQueryOptions.pageNum).toEqual(pageNum + 1);

    // It should have loaded metadata for all of them.
    expect(mockGetMetadata).toBeCalledWith(queryResult.imageIds);
    expect(newState.imageView.metadataLoadingState).toEqual(
      RequestState.SUCCEEDED
    );

    for (const backendId of queryResult.imageIds) {
      // It should have added the query results to the state.
      const frontendId = createArtifactEntityId(backendId.id);
      expect(newState.imageView.ids).toContain(frontendId);
      // It should have set the metadata.
      expect(newState.imageView.entities[frontendId].metadata).toEqual(
        fakeMetadata
      );
    }
  });

  each([
    ["there is no current query", [], true, 3],
    ["there are no more pages", [{}], false, 3],
    ["this page was already loaded", [{}], true, 2],
  ]).it(
    "ignores a thunkContinueQuery call when %s",
    async (
      _: string,
      query: ImageQuery[],
      hasMorePages: boolean,
      pageNum: number
    ) => {
      // Arrange.
      // Set up the state.
      const state = fakeState();
      state.imageView.currentQuery = query;
      state.imageView.currentQueryHasMorePages = hasMorePages;
      state.imageView.currentQueryOptions.pageNum = 2;
      const store = setupStore(state);

      // Act.
      await thunkContinueQuery(pageNum)(store.dispatch, store.getState, {});

      // Assert.
      // It should not have performed a query.
      expect(mockQueryImages).not.toHaveBeenCalled();
    }
  );

  it("creates a loadThumbnail action", async () => {
    // Arrange.
    // Make it look like the loadThumbnail request succeeds.
    const rawImage = fakeFile();
    mockLoadThumbnail.mockResolvedValue(rawImage);

    // Make it look like creatObjectURL produces a defined URL.
    const imageUrl = faker.image.dataUri();
    mockCreateObjectUrl.mockReturnValue(imageUrl);

    // Initialize the store with valid state.
    const unloadedImage1 = fakeArtifactEntity(false);
    const unloadedImage1Id = createArtifactEntityId(
      unloadedImage1.backendId.id
    );
    const unloadedImage2 = fakeArtifactEntity(false);
    const unloadedImage2Id = createArtifactEntityId(
      unloadedImage2.backendId.id
    );
    const loadedImage = fakeArtifactEntity(true);
    const loadedImageId = createArtifactEntityId(loadedImage.backendId.id);
    const unloadedImageIds = [unloadedImage1Id, unloadedImage2Id];
    const state = fakeState();
    state.imageView.ids = [unloadedImage1Id, unloadedImage2Id, loadedImageId];
    state.imageView.entities[unloadedImage1Id] = unloadedImage1;
    state.imageView.entities[unloadedImage2Id] = unloadedImage2;
    state.imageView.entities[loadedImageId] = loadedImage;
    state.imageView.numThumbnailsLoaded = 1;
    const store = setupStore(state);

    // Act.
    const asyncThunkDispatch = jest.fn();
    thunkLoadThumbnails([unloadedImage1Id, loadedImageId, unloadedImage2Id], 2)(
      asyncThunkDispatch,
      store.getState as () => RootState,
      {}
    );

    // Manually dispatch the sub-actions.
    expect(asyncThunkDispatch).toHaveBeenCalledTimes(2);
    const subActions = asyncThunkDispatch.mock.calls.map((c) => c[0]);
    const subActionPromises = [];
    for (const subAction of subActions) {
      subActionPromises.push(subAction(store.dispatch, store.getState, {}));
    }

    // Assert.
    let newState = store.getState().imageView;
    // It should have updated the loading status.
    for (const id of unloadedImageIds) {
      expect(newState.entities[id]?.thumbnailStatus).toEqual(
        ArtifactStatus.LOADING
      );
    }
    // Act.
    // Wait for the sub-actions to complete.
    await Promise.allSettled(subActionPromises);

    // Assert.
    // It should have loaded two thumbnails.
    expect(mockLoadThumbnail).toHaveBeenCalledTimes(2);

    newState = store.getState().imageView;

    // Assert.
    // It should have updated the entities for the images.
    for (const id of unloadedImageIds) {
      const imageEntity = newState.entities[id];
      expect(imageEntity?.thumbnailStatus).toEqual(ArtifactStatus.LOADED);
      expect(imageEntity?.thumbnailUrl).toEqual(imageUrl);
    }

    // It should have updated the tracker for the number of loaded thumbnails.
    expect(newState.numThumbnailsLoaded).toEqual(state.imageView.ids.length);
  });

  it("handles failures when loading thumbnails", async () => {
    // Arrange.
    // Make it look like the loadThumbnail request fails.
    mockLoadThumbnail.mockRejectedValue(undefined);

    // Initialize the fake store with valid state.
    const unloadedImage1 = fakeArtifactEntity(false);
    const unloadedImage1Id = createArtifactEntityId(
      unloadedImage1.backendId.id
    );
    const state = fakeState();
    state.imageView.ids = [unloadedImage1Id];
    state.imageView.entities[unloadedImage1Id] = unloadedImage1;
    const store = setupStore(state);

    // Act.
    const asyncThunkDispatch = jest.fn();
    thunkLoadThumbnails([unloadedImage1Id], 2)(
      asyncThunkDispatch,
      store.getState as () => RootState,
      {}
    );

    // Manually dispatch the sub-actions.
    expect(asyncThunkDispatch).toBeCalledTimes(1);
    const subActions = asyncThunkDispatch.mock.calls.map((c) => c[0]);
    for (const subAction of subActions) {
      await subAction(store.dispatch, store.getState, {});
    }

    // Assert.
    // It should have tried to load the thumbnail.
    expect(mockLoadThumbnail).toBeCalledTimes(1);
  });

  it("does not reload thumbnails when they're all already loaded", async () => {
    // Arrange.
    // Make it look like the thumbnail is already loaded.
    const imageId: string = faker.datatype.uuid();
    const state = fakeState();
    state.imageView.ids = [imageId];
    state.imageView.entities[imageId] = fakeArtifactEntity(true);
    const store = setupStore(state);

    // Act.
    await thunkLoadThumbnails([imageId])(
      store.dispatch,
      store.getState as () => RootState,
      {}
    );

    // Assert.
    // It should not have loaded the thumbnail.
    expect(mockLoadThumbnail).not.toHaveBeenCalled();
  });

  it("creates a loadImage action", async () => {
    // Arrange.
    // Make it look like the loadImage request succeeds.
    const rawImage = fakeFile();
    mockLoadImage.mockResolvedValue(rawImage);

    // Make it look like creatObjectURL produces a defined URL.
    const imageUrl = faker.image.dataUri();
    mockCreateObjectUrl.mockReturnValue(imageUrl);

    // Initialize the fake store with valid state.
    const imageEntity = fakeArtifactEntity(undefined, false);
    const imageId: string = createArtifactEntityId(imageEntity.backendId.id);
    const state = fakeState();
    state.imageView.ids = [imageId];
    state.imageView.entities[imageId] = imageEntity;
    const store = setupStore(state);

    // Act.
    const loadImagePromise = thunkLoadImage(imageId)(
      store.dispatch,
      store.getState,
      {}
    );

    // Assert.
    let newState = store.getState().imageView;
    // It should have updated the loading status.
    expect(newState.entities[imageId]?.imageStatus).toEqual(
      ArtifactStatus.LOADING
    );

    // Act.
    // Wait for loading to finish.
    await loadImagePromise;

    // Assert.
    // It should have loaded the image.
    expect(mockLoadImage).toBeCalledTimes(1);

    // Assert.
    newState = store.getState().imageView;
    // It should have updated the entity for the image.
    const newEntity = newState.entities[imageId];
    expect(newEntity?.imageStatus).toEqual(ArtifactStatus.LOADED);
    expect(newEntity?.artifactUrl).toEqual(imageUrl);
  });

  it("does not reload an image that is already loaded", async () => {
    // Arrange.
    // Make it look like the image is already loaded.
    const imageId: string = faker.datatype.uuid();
    const state = fakeState();
    state.imageView.ids = [imageId];
    state.imageView.entities[imageId] = fakeArtifactEntity(undefined, true);
    const store = setupStore(state);

    // Act.
    await thunkLoadImage(imageId)(store.dispatch, store.getState, {});

    // Assert.
    // It should not have loaded the image.
    expect(mockLoadImage).not.toHaveBeenCalled();
  });

  it("creates a loadMetadata action", async () => {
    // Arrange.
    // Make it look like the getMetadata request succeeds.
    const newMetadata: UavImageMetadata = {
      captureDate: faker.date.past().toISOString(),
    };
    mockGetMetadata.mockResolvedValue([newMetadata]);

    // Initialize the fake store with valid state.
    const unloadedImage = fakeArtifactEntity(false, false);
    unloadedImage.metadata = null;
    const loadedImage = fakeArtifactEntity(undefined, true);
    const unloadedImageId = createArtifactEntityId(unloadedImage.backendId.id);
    const loadedImageId = createArtifactEntityId(loadedImage.backendId.id);
    const state = fakeState();
    state.imageView.ids = [unloadedImageId, loadedImageId];
    state.imageView.entities[unloadedImageId] = unloadedImage;
    // Make it look like this one is already loaded.
    state.imageView.entities[loadedImageId] = loadedImage;
    const store = setupStore(state);

    // Act.
    const loadMetadataPromise = thunkLoadMetadata([
      unloadedImageId,
      loadedImageId,
    ])(store.dispatch, store.getState, {});

    // Assert.
    let newState = store.getState().imageView;
    // It should have marked the metadata as loading.
    expect(newState.metadataLoadingState).toEqual(RequestState.LOADING);

    // It should have updated the loading status.
    for (const imageId of state.imageView.ids) {
      expect(newState.entities[imageId]?.metadataStatus).toEqual(
        ArtifactStatus.LOADING
      );
    }

    // Act.
    // Wait for the loading to finish.
    await loadMetadataPromise;

    // Assert.
    // It should have loaded the metadata.
    expect(mockGetMetadata).toBeCalledTimes(1);

    // Assert.
    newState = store.getState().imageView;
    // It should have updated the entity for the image.
    expect(newState.entities[unloadedImageId]?.metadata).toEqual(newMetadata);
    // It should have not changed the one that was already loaded.
    expect(newState.entities[loadedImageId]?.metadata).toEqual(
      loadedImage.metadata
    );

    // It should have marked the metadata as loaded.
    expect(newState.metadataLoadingState).toEqual(RequestState.SUCCEEDED);
  });

  it("does not reload metadata that is already loaded", async () => {
    // Arrange.
    // Make it look like the image metadata is already loaded.
    const imageId: string = faker.datatype.uuid();
    const state = fakeState();
    state.imageView.ids = [imageId];
    state.imageView.entities[imageId] = fakeArtifactEntity(true, true);
    const store = setupStore(state);

    // Act.
    await thunkLoadMetadata([imageId])(store.dispatch, store.getState, {});

    // Assert.
    // It should not have loaded the metadata.
    expect(mockGetMetadata).not.toHaveBeenCalled();
  });

  describe("actions with selected images", () => {
    /**
     * Fake image entities to use for testing.
     */
    let imageEntities: ArtifactEntity[];
    /**
     * Fake frontend IDs to use for testing.
     */
    let frontendIds: string[];
    /**
     * We make it look like these images are selected.
     */
    let selectedIds: string[];
    /**
     * Fake Redux state to use for testing.
     */
    let state: RootState;

    beforeEach(() => {
      imageEntities = [
        fakeArtifactEntity(true, true),
        fakeArtifactEntity(true, true),
        fakeArtifactEntity(true, true),
      ];
      frontendIds = imageEntities.map((e) =>
        createArtifactEntityId(e.backendId.id)
      );
      selectedIds = frontendIds.slice(0, 2);

      // Set up the state correctly.
      state = fakeState();
      state.imageView.ids = frontendIds;
      for (let i = 0; i < imageEntities.length; ++i) {
        state.imageView.entities[frontendIds[i]] = imageEntities[i];
        imageEntities[i].isSelected = false;
      }
      // Mark selected images as selected.
      for (const id of selectedIds) {
        (state.imageView.entities[id] as ArtifactEntity).isSelected = true;
      }
    });

    it("creates a BulkDownloadSelected action", async () => {
      // Arrange.
      // Make it look like some items are selected.
      const imageView = state.imageView;
      const selectedImage1 = imageView.entities[
        selectedIds[0]
      ] as ArtifactEntity;
      const selectedImage2 = imageView.entities[
        selectedIds[1]
      ] as ArtifactEntity;

      const store = setupStore(state);

      // Act.
      const downloadPromise = thunkBulkDownloadSelected()(
        store.dispatch,
        store.getState,
        {}
      );

      // Assert.
      let newState = store.getState().imageView;
      // It should have marked the bulk download as running.
      expect(newState.bulkDownloadState).toEqual(RequestState.LOADING);

      // Act.
      // Wait for the download to complete.
      await downloadPromise;

      // Assert.
      // It should have downloaded the selected items.
      expect(mockDownloadArtifactZip).toBeCalledTimes(1);
      const downloadList = mockDownloadArtifactZip.mock.calls[0][0];
      expect(downloadList).toHaveLength(2);
      expect(downloadList).toContainEqual({
        id: selectedImage1.backendId,
        metadata: selectedImage1.metadata,
      });
      expect(downloadList).toContainEqual({
        id: selectedImage2.backendId,
        metadata: selectedImage2.metadata,
      });

      // It should have marked the bulk download as finished.
      newState = store.getState().imageView;
      expect(newState.bulkDownloadState).toEqual(RequestState.SUCCEEDED);
    });

    it("does not try to perform two bulk downloads at once", async () => {
      // Arrange.
      const imageView = state.imageView;
      // Make it look like a bulk download is already running.
      imageView.bulkDownloadState = RequestState.LOADING;

      const store = setupStore(state);

      // Act.
      await thunkBulkDownloadSelected()(store.dispatch, store.getState, {});

      // Assert.
      // It should not have run any downloads.
      expect(mockDownloadArtifactZip).not.toHaveBeenCalled();
    });

    it("updates the metadata of selected images", async () => {
      // Arrange.
      const metadata = fakeImageMetadata();

      const store = setupStore(state);
      // It doesn't actually have to return anything.
      mockBatchUpdateMetadata.mockResolvedValue(undefined);

      // Act.
      const updatePromise = thunkUpdateSelectedMetadata(metadata)(
        store.dispatch,
        store.getState,
        {}
      );

      // Assert.
      let newState = store.getState().imageView;
      // It should have marked the bulk download as running.
      expect(newState.metadataEditingState).toEqual(RequestState.LOADING);

      // Act.
      // Wait for the update to complete.
      const result = await updatePromise;

      // Assert.
      // It should have updated the metadata.
      expect(mockBatchUpdateMetadata).toHaveBeenCalledWith(
        metadata,
        selectedIds.map((id) => state.imageView.entities[id]?.backendId)
      );

      // It should have returned the IDs of the updated images.
      expect(result.payload).toEqual(selectedIds);

      // It should have updated the metadata editing state to SUCCEEDED.
      newState = store.getState().imageView;
      expect(newState.metadataEditingState).toEqual(RequestState.SUCCEEDED);
      // It should have cleared the image view state.
      expect(newState.ids).toHaveLength(0);
    });

    describe("thunkDeleteSelected", () => {
      it("should delete selected images and return their IDs", async () => {
        // Arrange
        const store = setupStore(state);
        // It doesn't actually have to return anything.
        mockDeleteImages.mockResolvedValue(undefined);

        // Act
        const deletePromise = thunkDeleteSelected()(
          store.dispatch,
          store.getState,
          {}
        );

        // Assert.
        // It should have changed the imageDeletionState to loading.
        let newState = store.getState().imageView;
        expect(newState.imageDeletionState).toEqual(RequestState.LOADING);

        // Act.
        // Wait for the deletion to finish.
        const result = await deletePromise;

        // Assert
        // It should have deleted the selected images.
        const selectedBackendIds = selectedIds.map(
          (id) => state.imageView.entities[id]?.backendId.id
        );
        expect(mockDeleteImages).toHaveBeenCalledWith(selectedBackendIds);
        // It should have returned the IDs of the images that it deleted.
        expect(result.payload).toEqual(selectedIds);

        // Assert.
        // It should have removed the deleted images from the frontend state.
        newState = store.getState().imageView;
        // It should have changed the imageDeletionState to "succeeded".
        expect(newState.imageDeletionState).toEqual(RequestState.SUCCEEDED);
        // It should have reset the number of selected items to 0.
        expect(newState.numItemsSelected).toEqual(0);

        // It should have deleted the selected items.
        expect(newState.ids.length).toEqual(
          frontendIds.length - selectedIds.length
        );
        for (const id of selectedIds) {
          expect(newState.ids).not.toContain(id);
        }
      });

      it("should do nothing if no images are selected", async () => {
        // Arrange
        // We add a single image that is not selected.
        const state = fakeState();
        const imageEntity = fakeArtifactEntity();
        imageEntity.isSelected = false;
        const frontendId = createArtifactEntityId(imageEntity.backendId.id);
        state.imageView.ids = [frontendId];
        state.imageView.entities[frontendId] = imageEntity;

        const store = setupStore(state);

        // Act
        const result = await thunkDeleteSelected()(
          store.dispatch,
          store.getState,
          {}
        );

        // Assert
        expect(mockDeleteImages).toBeCalledWith([]);
        expect(result.payload).toEqual([]);
      });
    });

    it("can export selected images with thunkExportSelected", async () => {
      // Arrange.
      const store = setupStore(state);
      const exportedUrl = faker.internet.url();
      mockMakeArtifactUrlList.mockResolvedValue(exportedUrl);

      // Act.
      await thunkExportSelected()(
        store.dispatch,
        store.getState as () => RootState,
        {}
      );

      // Assert.
      // It should have made the list of URLs.
      expect(makeArtifactUrlList).toHaveBeenCalledTimes(1);
      expect(makeArtifactUrlList).toHaveBeenCalledWith(
        selectedIds.map((id) => state.imageView.entities[id]?.backendId)
      );

      // It should have updated the state.
      const newState = store.getState().imageView;
      expect(newState.exportedImagesUrl).toEqual(exportedUrl);
    });

    it("can clear exported images URL with thunkClearExportedImages", () => {
      // Arrange.
      const exportedUrl = faker.internet.url();

      // Create the fake state.
      state.imageView.exportedImagesUrl = exportedUrl;

      const store = setupStore(state);

      // Act.
      thunkClearExportedImages()(
        store.dispatch,
        store.getState as () => RootState,
        {}
      );

      // Assert.
      // It should have revoked the URL.
      expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith(exportedUrl);

      // It should have updated the state.
      const newState = store.getState().imageView;
      expect(newState.exportedImagesUrl).toBeNull();
    });

    it("does nothing if the exported images URL is null", () => {
      // Arrange.
      const store = setupStore(fakeState());

      // Act.
      thunkClearExportedImages()(
        store.dispatch,
        store.getState as () => RootState,
        {}
      );

      // Assert.
      // It should not have revoked anything.
      expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    });
  });

  it("creates a doAutocomplete action", async () => {
    // Arrange.
    // Make it look like it got some autocomplete suggestions.
    const suggestions = fakeSuggestions();
    mockRequestAutocomplete.mockResolvedValue(suggestions.textCompletions);
    mockUpdateMenu.mockReturnValue(suggestions.menu);

    // Initialize the fake store with valid state.
    const state = fakeState();
    state.imageView.search.queryState = RequestState.IDLE;
    state.imageView.search.searchString = "";
    const store = setupStore(state);

    // Act.
    const searchString = faker.lorem.sentence();
    const numSuggestions = faker.datatype.number();
    const autocompletePromise = thunkDoAutocomplete({
      searchString: searchString,
      numSuggestions: numSuggestions,
    })(store.dispatch, store.getState, {});

    // Assert.
    let newState = store.getState().imageView;
    // It should have marked the query request as loading.
    expect(newState.search.queryState).toEqual(RequestState.LOADING);
    // It should have saved the search string.
    expect(newState.search.searchString).toEqual(searchString);

    // It should have updated the autocomplete menu.
    expect(mockUpdateMenu).toHaveBeenCalledWith(searchString);
    expect(newState.search.autocompleteSuggestions.menu).toEqual(
      suggestions.menu
    );

    // Act.
    // Wait for autocomplete to finish.
    await autocompletePromise;

    // Assert.
    // It should have performed the autocomplete request.
    expect(mockRequestAutocomplete).toBeCalledWith(
      searchString,
      numSuggestions
    );

    newState = store.getState().imageView;
    // It should have marked the query request as succeeded.
    expect(newState.search.queryState).toEqual(RequestState.SUCCEEDED);
    // It should have saved the suggestions.
    expect(newState.search.autocompleteSuggestions.textCompletions).toEqual(
      suggestions.textCompletions
    );
    // It should have configured the menu.
    expect(newState.search.autocompleteSuggestions.menu).toEqual(
      suggestions.menu
    );
  });

  it("can start queries with thunkTextSearch", () => {
    // Arrange.
    // Make it look like we can generate queries.
    const queries = [fakeImageQuery(), fakeImageQuery()];
    mockQueriesFromSearchString.mockReturnValue(queries);

    // Initialize the fake store with valid state.
    const state = fakeState();
    const store = setupStore(state);

    // Act.
    const searchString = faker.lorem.words();
    thunkTextSearch(searchString)(
      store.dispatch,
      store.getState as () => RootState,
      {}
    );

    // Assert.
    // It should have generated the queries.
    expect(mockQueriesFromSearchString).toBeCalledWith(searchString);
  });

  each([
    ["loaded", true],
    ["not loaded", false],
  ]).it(
    "creates a clearFullSizedImages action when the image is %s",
    (_: string, imageLoaded: boolean) => {
      // Arrange.
      // Set up the state appropriately.
      const images = fakeArtifactEntities(undefined, undefined, imageLoaded);
      const state = fakeState();
      state.imageView.ids = images.ids;
      state.imageView.entities = images.entities;
      const store = setupStore(state);

      // Act.
      thunkClearFullSizedImages(images.ids)(
        store.dispatch,
        store.getState as () => RootState,
        {}
      );

      // Assert.
      if (imageLoaded) {
        // It should have released the loaded image.
        expect(mockRevokeObjectUrl).toBeCalledTimes(images.ids.length);
        for (const id of images.ids) {
          expect(mockRevokeObjectUrl).toBeCalledWith(
            images.entities[id].artifactUrl
          );
        }
      } else {
        expect(mockRevokeObjectUrl).not.toHaveBeenCalled();
      }

      // It should have removed the image.
      const newState = store.getState();
      const imageEntities = thumbnailGridSelectors.selectAll(newState);
      expect(imageEntities).toHaveLength(images.ids.length);
      for (const image of imageEntities) {
        expect(image.artifactUrl).toBeNull();
        expect(image.imageStatus).toEqual(ArtifactStatus.NOT_LOADED);
      }
    }
  );

  it("Does nothing when no image is passed to clearFullSizedImages", () => {
    // Arrange.
    const store = setupStore(fakeState());

    // Act.
    thunkClearFullSizedImages([undefined])(
      store.dispatch,
      store.getState as () => RootState,
      {}
    );

    // Assert.
    // It should have done nothing.
    expect(mockRevokeObjectUrl).not.toHaveBeenCalled();
  });

  each([
    ["loaded", true],
    ["not loaded", false],
  ]).it(
    "creates a clearThumbnails action when the image is %s",
    (_: string, thumbnailLoaded: boolean) => {
      // Arrange.
      // Set up the state appropriately.
      const images = fakeArtifactEntities(undefined, thumbnailLoaded);
      const state = fakeState();
      state.imageView.ids = images.ids;
      state.imageView.entities = images.entities;
      state.imageView.numThumbnailsLoaded = thumbnailLoaded
        ? images.ids.length
        : 0;
      const store = setupStore(state);

      // Act.
      thunkClearThumbnails(images.ids)(
        store.dispatch,
        store.getState as () => RootState,
        {}
      );

      // Assert.
      if (thumbnailLoaded) {
        // It should have released the loaded thumbnails.
        expect(mockRevokeObjectUrl).toHaveBeenCalledTimes(images.ids.length);
        for (const id of images.ids) {
          expect(mockRevokeObjectUrl).toHaveBeenCalledWith(
            images.entities[id].thumbnailUrl
          );
        }
      } else {
        expect(mockRevokeObjectUrl).not.toHaveBeenCalled();
      }

      // It should have removed the thumbnails.
      const newState = store.getState();
      const imageEntities = thumbnailGridSelectors.selectAll(newState);
      expect(imageEntities).toHaveLength(images.ids.length);
      for (const image of imageEntities) {
        expect(image.thumbnailUrl).toBeNull();
        expect(image.thumbnailStatus).toEqual(ArtifactStatus.NOT_LOADED);
      }

      // It should have updated the counter for the number of loaded thumbnails.
      expect(newState.imageView.numThumbnailsLoaded).toEqual(0);
    }
  );

  it("Does nothing when no image is passed to clearThumbnails", () => {
    // Arrange.
    const store = setupStore(fakeState());

    // Act.
    thunkClearThumbnails([undefined])(
      store.dispatch,
      store.getState as () => RootState,
      {}
    );

    // Assert.
    // It should have done nothing.
    expect(mockRevokeObjectUrl).not.toHaveBeenCalled();
  });

  it("can clear all the images with thunkClearImageView", () => {
    // Arrange.
    const images = fakeArtifactEntities(undefined, true, true);
    const state = fakeState();
    state.imageView.ids = images.ids;
    state.imageView.entities = images.entities;
    const store = setupStore(state);

    // Act.
    thunkClearImageView()(
      store.dispatch,
      store.getState as () => RootState,
      {}
    );

    // Assert.
    // It should have removed all images.
    const newState = store.getState();
    const imageEntities = thumbnailGridSelectors.selectAll(newState);
    expect(imageEntities).toHaveLength(0);
  });

  each([
    ["select, all changed", true, true],
    ["select, none changed", true, false],
    ["deselect, all changed", false, true],
    ["deselect, none changed", false, false],
  ]).it(
    "can select/deselect all the images (%s)",
    (_, select: boolean, changeSelection: boolean) => {
      // Arrange.
      // Make it look like there are various images.
      const images = fakeArtifactEntities();
      // Make it look like all or none are selected.
      for (const id of images.ids) {
        images.entities[id].isSelected = changeSelection ? !select : select;
      }

      const state = fakeState();
      state.imageView.ids = images.ids;
      state.imageView.entities = images.entities;

      const store = setupStore(state);

      // Act.
      thunkSelectAll(select)(
        store.dispatch,
        store.getState as () => RootState,
        {}
      );

      // Assert.
      // It should have selected/deselected all.
      const newState = store.getState();
      const imageIds = thumbnailGridSelectors.selectIds(newState);
      for (const id of imageIds) {
        expect(newState.imageView.entities[id].isSelected).toEqual(select);
      }
    }
  );

  each([
    ["select", true],
    ["deselect", false],
  ]).it("can %s multiple images", (_, select: boolean) => {
    // Arrange.
    // Make it look like there are various images.
    const images = fakeArtifactEntities(50);

    const state = fakeState();
    state.imageView.ids = images.ids;
    state.imageView.entities = images.entities;

    const store = setupStore(state);

    // Act.
    thunkSelectImages({ imageIds: images.ids, select: select })(
      store.dispatch,
      store.getState as () => RootState,
      {}
    );

    // Assert.
    const newState = store.getState().imageView;
    // It should have selected/deselected the images.
    for (const id of newState.ids) {
      expect(newState.entities[id].isSelected).toEqual(select);
    }
  });

  each([
    ["is not registered", undefined],
    ["is registered", fakeArtifactEntity()],
  ]).it(
    "can set a new image to show details for when the image %s",
    (_, imageEntity?: ArtifactEntity) => {
      // Arrange.
      // Create a fake image.
      const backendId = imageEntity?.backendId ?? fakeTypedObjectRef();
      const frontendId = createArtifactEntityId(backendId.id);

      const state = fakeState();
      if (imageEntity) {
        // Make it look lie this image exists.
        state.imageView.ids = [frontendId];
        state.imageView.entities[frontendId] = imageEntity;
      }
      const store = setupStore(state);

      // Act.
      thunkShowDetails(backendId)(
        store.dispatch,
        store.getState as () => RootState,
        {}
      );

      // Assert.
      const newState = store.getState().imageView;
      expect(newState.details.frontendId).toEqual(frontendId);
    }
  );
});

describe("thumbnail-grid-slice reducers", () => {
  beforeEach(() => {
    // Set the faker seed.
    faker.seed(1337);
  });

  each([
    ["clear query", undefined],
    ["preserve query", true],
  ]).it(
    "handles a clearImageView action (%s)",
    (_, preserveQuery?: boolean) => {
      // Arrange.
      const state: RootState = fakeState();
      // Make it look like an image is loaded.
      const imageId = faker.datatype.uuid();
      state.imageView.ids = [imageId];
      state.imageView.entities[imageId] = fakeArtifactEntity(undefined, true);

      // Make it look like some other parameters are set.
      state.imageView.currentQueryState = RequestState.SUCCEEDED;
      state.imageView.metadataLoadingState = RequestState.SUCCEEDED;

      // Act.
      const newImageState = thumbnailGridSlice.reducer(
        state.imageView,
        clearImageView({ preserveQuery: preserveQuery })
      );

      // Assert.
      const newState = fakeState();
      newState.imageView = newImageState;

      // It should have removed all images.
      const imageEntities = thumbnailGridSelectors.selectAll(newState);
      expect(imageEntities).toHaveLength(0);
      // It should have reset state parameters.
      expect(newImageState.currentQueryState).toEqual(RequestState.IDLE);
      expect(newImageState.metadataLoadingState).toEqual(RequestState.IDLE);
      expect(newImageState.currentQueryError).toEqual(null);
      expect(newImageState.currentQueryHasMorePages).toEqual(true);
      expect(newImageState.numItemsSelected).toEqual(0);
      expect(newImageState.numThumbnailsLoaded).toEqual(0);
      expect(newImageState.collapsedSections).toEqual({});

      if (preserveQuery) {
        // It should have maintained the current query but reset the page
        // number.
        expect(newImageState.currentQuery).toEqual(
          state.imageView.currentQuery
        );
        expect(newImageState.currentQueryOptions.pageNum).toEqual(0);
      } else {
        // It should have cleared the current query.
        expect(newImageState.currentQuery).toEqual([]);
        expect(newImageState.currentQueryOptions).toEqual({});
      }
    }
  );

  each([
    ["preserve search string", true, undefined],
    ["clear autocomplete", true, faker.lorem.words()],
    ["keep autocomplete", true, faker.lorem.words()],
  ]).it(
    "handles a setSearchString action (%s)",
    (_, clearAutocomplete: boolean, searchString?: string) => {
      // Arrange.
      const state: RootState = fakeState();
      // Make it look like we have some autocomplete suggestions.
      state.imageView.search.searchString = faker.lorem.words();
      state.imageView.search.autocompleteSuggestions = fakeSuggestions();
      state.imageView.search.queryState = RequestState.SUCCEEDED;

      // Act.
      const newImageState = thumbnailGridSlice.reducer(
        state.imageView,
        setSearchString({
          searchString: searchString,
          clearAutocomplete: clearAutocomplete,
        })
      );

      // Assert.
      if (searchString === undefined) {
        // It should not actually change the search string.
        expect(newImageState.search.searchString).toEqual(
          state.imageView.search.searchString
        );
      } else {
        expect(newImageState.search.searchString).toEqual(searchString);
      }

      if (clearAutocomplete) {
        // It should have cleared the autocomplete suggestions.
        expect(newImageState.search.autocompleteSuggestions.menu).toEqual(
          AutocompleteMenu.NONE
        );
        expect(
          newImageState.search.autocompleteSuggestions.textCompletions
        ).toHaveLength(0);
        expect(newImageState.search.queryState).toEqual(RequestState.IDLE);
      } else {
        // It should have preserved the suggestions.
        expect(newImageState.search.autocompleteSuggestions).toEqual(
          state.imageView.search.autocompleteSuggestions
        );
      }
    }
  );

  it("handles a selectImages action", () => {
    // Arrange.
    const state = fakeState().imageView;
    // Make it look like some images are selected.
    const selectedImage1 = fakeArtifactEntity();
    selectedImage1.isSelected = true;
    const selectedImage2 = fakeArtifactEntity();
    selectedImage2.isSelected = true;
    const unselectedImage1 = fakeArtifactEntity();
    unselectedImage1.isSelected = false;
    const unselectedImage2 = fakeArtifactEntity();
    unselectedImage2.isSelected = false;

    const selectedImage1Id = createArtifactEntityId(
      selectedImage1.backendId.id
    );
    const selectedImage2Id = createArtifactEntityId(
      selectedImage2.backendId.id
    );
    const unselectedImage1Id = createArtifactEntityId(
      unselectedImage1.backendId.id
    );
    const unselectedImage2Id = createArtifactEntityId(
      unselectedImage2.backendId.id
    );
    state.ids = [
      selectedImage1Id,
      selectedImage2Id,
      unselectedImage1Id,
      unselectedImage2Id,
    ];
    state.entities[selectedImage1Id] = selectedImage1;
    state.entities[selectedImage2Id] = selectedImage2;
    state.entities[unselectedImage1Id] = unselectedImage1;
    state.entities[unselectedImage2Id] = unselectedImage2;

    // Act.
    // Attempt to change the selection status on some images.
    const stateAfterSelect = thumbnailGridSlice.reducer(
      state,
      selectImages({
        imageIds: [selectedImage1Id, unselectedImage1Id],
        select: true,
      })
    );
    const stateAfterDeselect = thumbnailGridSlice.reducer(
      state,
      selectImages({
        imageIds: [selectedImage2Id, unselectedImage2Id],
        select: false,
      })
    );

    // Assert.
    // It should have selected the correct images.
    expect(stateAfterSelect.entities[selectedImage1Id]?.isSelected).toEqual(
      true
    );
    expect(stateAfterSelect.entities[selectedImage2Id]?.isSelected).toEqual(
      true
    );
    expect(stateAfterSelect.entities[unselectedImage1Id]?.isSelected).toEqual(
      true
    );
    expect(stateAfterSelect.entities[unselectedImage2Id]?.isSelected).toEqual(
      false
    );

    expect(stateAfterDeselect.entities[selectedImage1Id]?.isSelected).toEqual(
      true
    );
    expect(stateAfterDeselect.entities[selectedImage2Id]?.isSelected).toEqual(
      false
    );
    expect(stateAfterDeselect.entities[unselectedImage1Id]?.isSelected).toEqual(
      false
    );
    expect(stateAfterDeselect.entities[unselectedImage2Id]?.isSelected).toEqual(
      false
    );
  });

  it("handles a setEditingDialogOpen action", () => {
    // Arrange.
    const state: RootState = fakeState();
    const isOpen = faker.datatype.boolean();

    // Act.
    const newImageState = thumbnailGridSlice.reducer(
      state.imageView,
      setEditingDialogOpen(isOpen)
    );

    // Assert.
    expect(newImageState.editingDialogOpen).toEqual(isOpen);
  });

  it("handles a clearVideoUrl action", () => {
    // Arrange.
    const originalUrl = faker.internet.url();
    // Set up the state with the video.
    const state: RootState = fakeState();
    const entity = fakeArtifactEntity();
    entity.backendId.type = ObjectType.VIDEO;
    entity.artifactUrl = originalUrl;
    const entityId = createArtifactEntityId(entity.backendId.id);
    state.imageView.ids = [entityId];
    state.imageView.entities[entityId] = entity;

    // Act.
    const newImageState = thumbnailGridSlice.reducer(
      state.imageView,
      clearVideoUrl(entityId)
    );

    // Assert.
    expect(newImageState.entities[entityId]?.artifactUrl).toBeNull();
  });

  it("handles a clearVideoUrl action when the artifact is not a video", () => {
    // Arrange.
    const originalUrl = faker.internet.url();
    // Set up the state with an image.
    const state: RootState = fakeState();
    const entity = fakeArtifactEntity();
    entity.backendId.type = ObjectType.IMAGE;
    entity.artifactUrl = originalUrl;
    const entityId = createArtifactEntityId(entity.backendId.id);
    state.imageView.ids = [entityId];
    state.imageView.entities[entityId] = entity;

    // Act.
    const newImageState = thumbnailGridSlice.reducer(
      state.imageView,
      clearVideoUrl(entityId)
    );

    // Assert.
    // It should have changed nothing.
    expect(newImageState.entities[entityId]?.artifactUrl).toEqual(originalUrl);
  });

  it("handles a setScrollLocation action", () => {
    // Arrange.
    const state = fakeState();
    state.imageView.lastScrollLocation = 0;

    // Act.
    // Set a new scroll location.
    const newSrollLocation = faker.datatype.number();
    const newImageState = thumbnailGridSlice.reducer(
      state.imageView,
      setScrollLocation(newSrollLocation)
    );

    // Assert.
    expect(newImageState.lastScrollLocation).toEqual(newSrollLocation);
  });

  each([
    ["collapse", false],
    ["expand", true],
  ]).it("handles a setSectionExpanded action (%s)", (_, expand: boolean) => {
    // Arrange.
    const state: RootState = fakeState();
    const sectionName = faker.lorem.words();

    if (!expand) {
      // Make it look like it's initially expanded.
      state.imageView.collapsedSections[sectionName] = true;
    }

    // Act.
    const newImageState = thumbnailGridSlice.reducer(
      state.imageView,
      setSectionExpanded({ sectionName: sectionName, expand: expand })
    );

    // Assert.
    if (expand) {
      // It should have expanded the section.
      expect(newImageState.collapsedSections[sectionName]).not.toEqual(true);
    } else {
      // It should have collapsed the section.
      expect(newImageState.collapsedSections[sectionName]).toEqual(true);
    }
  });

  it(`does not update autocomplete if the search has already run`, () => {
    // Arrange.
    const state: ImageViewState = fakeState().imageView;
    // Make it look like the search is complete.
    state.search.queryState = RequestState.IDLE;
    state.search.searchString = faker.lorem.words();
    state.search.autocompleteSuggestions.menu = AutocompleteMenu.NONE;
    state.search.autocompleteSuggestions.textCompletions = [];

    // Act.
    const suggestions = fakeSuggestions();
    const newState: ImageViewState = thumbnailGridReducer(state, {
      type: thunkDoAutocomplete.fulfilled.type,
      payload: {
        completions: suggestions.textCompletions,
      },
    });

    // Assert.
    // It should have done nothing.
    expect(newState).toEqual(state);
  });
});
