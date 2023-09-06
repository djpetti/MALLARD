import configureStore, { MockStoreCreator } from "redux-mock-store";
import thumbnailGridReducer, {
  addArtifacts,
  setSearchString,
  clearFullSizedImages,
  clearImageView,
  clearThumbnails,
  createArtifactEntityId,
  selectImages,
  setEditingDialogOpen,
  setExportedImagesUrl,
  setSectionExpanded,
  showDetails,
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
  setVideoUrl,
  clearVideoUrl,
} from "../thumbnail-grid-slice";
import {
  ArtifactEntity,
  ImageQuery,
  ArtifactStatus,
  ImageViewState,
  RequestState,
  RootState,
} from "../types";
import thunk from "redux-thunk";
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
import {
  ObjectRef,
  ObjectType,
  QueryResponse,
  UavImageMetadata,
} from "mallard-api";
import each from "jest-each";
import {
  batchUpdateMetadata,
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
} from "../autocomplete";
import { downloadArtifactZip, makeArtifactUrlList } from "../downloads";
import { faker } from "@faker-js/faker";

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
    AutocompleteMenu: realAutocomplete.AutocompleteMenu,
  };
});

const mockRequestAutocomplete = requestAutocomplete as jest.MockedFn<
  typeof requestAutocomplete
>;
const mockQueriesFromSearchString = queriesFromSearchString as jest.MockedFn<
  typeof queriesFromSearchString
>;

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
  /** Factory function for a mocked Redux store. */
  let mockStoreCreator: MockStoreCreator;

  beforeAll(() => {
    // Initialize the mock store factory.
    mockStoreCreator = configureStore([thunk]);
  });

  beforeEach(() => {
    // Set the faker seed.
    faker.seed(1337);

    // Reset mocks.
    jest.clearAllMocks();
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
      // For metadata loading, we have to make it look like there are
      // already image entities.
      const frontendIds = queryResult.imageIds.map((i) =>
        createArtifactEntityId(i.id)
      );
      state.imageView.ids = frontendIds;
      state.imageView.entities[frontendIds[0]] = fakeArtifactEntity(
        false,
        false
      );
      state.imageView.entities[frontendIds[1]] = fakeArtifactEntity(
        false,
        false
      );

      const store = mockStoreCreator(state);
      // Fake query to perform.
      const queries: ImageQuery[] = [{}];

      // Act.
      await thunkStartNewQuery({ query: queries, startPageNum: startPage })(
        store.dispatch,
        store.getState,
        {}
      );

      // Assert.
      // It should have started the query.
      expect(mockQueryImages).toBeCalledTimes(1);

      // It should have dispatched the actions.
      const actions = store.getActions();
      expect(actions).toHaveLength(5);

      // First, it should dispatch a pending action.
      const pendingAction = actions[0];
      expect(pendingAction.type).toEqual(thunkStartNewQuery.pending.type);

      // Then, it should add the artifacts.
      const addArtifactsAction = actions[1];
      expect(addArtifactsAction.type).toEqual(addArtifacts.type);
      expect(addArtifactsAction.payload).toEqual(queryResult.imageIds);

      // Then, it should load metadata, which will dispatch two lifecycle
      // actions.
      const metadataPendingAction = actions[2];
      expect(metadataPendingAction.type).toEqual(
        thunkLoadMetadata.pending.type
      );
      expect(metadataPendingAction.meta.arg).toEqual(frontendIds);

      // The fulfilled actions should come last.
      const fulfilledAction = actions[3];
      expect(fulfilledAction.type).toEqual(thunkStartNewQuery.fulfilled.type);
      expect(fulfilledAction.payload.query).toEqual(queries);
      expect(fulfilledAction.payload.result).toEqual(queryResult);
      expect(fulfilledAction.payload.options).toMatchObject({
        pageNum: startPage ?? 1,
      });

      const metadataFulfilledAction = actions[4];
      expect(metadataFulfilledAction.type).toEqual(
        thunkLoadMetadata.fulfilled.type
      );
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

    // Make it look like the query request succeeds.
    const queryResult: QueryResponse = {
      imageIds: [fakeTypedObjectRef(), fakeTypedObjectRef()],
      pageNum: pageNum + 1,
      isLastPage: true,
    };
    mockQueryImages.mockResolvedValue(queryResult);

    // For metadata loading, we have to make it look like there are
    // already image entities.
    const frontendIds = queryResult.imageIds.map((i) =>
      createArtifactEntityId(i.id)
    );
    state.imageView.ids = frontendIds;
    state.imageView.entities[frontendIds[0]] = fakeArtifactEntity(false, false);
    state.imageView.entities[frontendIds[1]] = fakeArtifactEntity(false, false);
    const store = mockStoreCreator(state);

    // Act.
    await thunkContinueQuery(pageNum + 1)(store.dispatch, store.getState, {});

    // Assert.
    // It should have made the query.
    expect(mockQueryImages).toBeCalledTimes(1);
    expect(mockQueryImages).toBeCalledWith(
      state.imageView.currentQuery,
      state.imageView.currentQueryOptions.orderings,
      state.imageView.currentQueryOptions.resultsPerPage,
      pageNum + 1
    );

    // It should have dispatched the correct actions.
    const actions = store.getActions();
    expect(actions).toHaveLength(5);

    // First, it should dispatch the pending action.
    const pendingAction = actions[0];
    expect(pendingAction.type).toEqual(thunkContinueQuery.pending.type);

    // Then, it should add the artifacts.
    const addArtifactsAction = actions[1];
    expect(addArtifactsAction.type).toEqual(addArtifacts.type);
    expect(addArtifactsAction.payload).toEqual(queryResult.imageIds);

    // Then, it should load metadata, which will dispatch two lifecycle
    // actions.
    const metadataPendingAction = actions[2];
    expect(metadataPendingAction.type).toEqual(thunkLoadMetadata.pending.type);
    expect(metadataPendingAction.meta.arg).toEqual(frontendIds);

    // The fulfilled actions should come last.
    const fulfilledAction = actions[3];
    expect(fulfilledAction.type).toEqual(thunkContinueQuery.fulfilled.type);
    expect(fulfilledAction.payload.pageNum).toEqual(pageNum + 1);
    expect(fulfilledAction.payload.result).toEqual(queryResult);

    const metadataFulfilledAction = actions[4];
    expect(metadataFulfilledAction.type).toEqual(
      thunkLoadMetadata.fulfilled.type
    );
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
      const store = mockStoreCreator(state);

      // Act.
      await thunkContinueQuery(pageNum)(store.dispatch, store.getState, {});

      // Assert.
      // It should not have performed a query.
      expect(mockQueryImages).not.toBeCalled();

      // It should not have dispatched any actions.
      expect(store.getActions()).toHaveLength(0);
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

    // Initialize the fake store with valid state.
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
    const state = fakeState();
    state.imageView.ids = [unloadedImage1Id, unloadedImage2Id, loadedImageId];
    state.imageView.entities[unloadedImage1Id] = unloadedImage1;
    state.imageView.entities[unloadedImage2Id] = unloadedImage2;
    state.imageView.entities[loadedImageId] = loadedImage;
    const store = mockStoreCreator(state);

    // Act.
    const asyncThunkDispatch = jest.fn();
    thunkLoadThumbnails([unloadedImage1Id, loadedImageId, unloadedImage2Id], 2)(
      asyncThunkDispatch,
      store.getState as () => RootState,
      {}
    );

    // Manually dispatch the sub-actions.
    expect(asyncThunkDispatch).toBeCalledTimes(2);
    const subActions = asyncThunkDispatch.mock.calls.map((c) => c[0]);
    for (const subAction of subActions) {
      await subAction(store.dispatch, store.getState, {});
    }

    // Assert.
    // It should have loaded two thumbnail.
    expect(mockLoadThumbnail).toBeCalledTimes(2);

    // It should have dispatched the lifecycle actions.
    const actions = store.getActions();
    expect(actions).toHaveLength(4);

    const pendingAction1 = actions[0];
    expect(pendingAction1.type).toEqual(
      "thumbnailGrid/loadThumbnailsChunk/pending"
    );

    const fulfilledAction1 = actions[1];
    expect(fulfilledAction1.type).toEqual(
      "thumbnailGrid/loadThumbnailsChunk/fulfilled"
    );
    expect(fulfilledAction1.payload).toHaveLength(1);
    expect(fulfilledAction1.payload[0].imageId).toEqual(unloadedImage1Id);
    expect(fulfilledAction1.payload[0].imageUrl).toEqual(imageUrl);

    const pendingAction2 = actions[2];
    expect(pendingAction2.type).toEqual(
      "thumbnailGrid/loadThumbnailsChunk/pending"
    );

    const fulfilledAction2 = actions[3];
    expect(fulfilledAction2.type).toEqual(
      "thumbnailGrid/loadThumbnailsChunk/fulfilled"
    );
    expect(fulfilledAction2.payload).toHaveLength(1);
    expect(fulfilledAction2.payload[0].imageId).toEqual(unloadedImage2Id);
    expect(fulfilledAction2.payload[0].imageUrl).toEqual(imageUrl);
  });

  it("does not reload a thumbnails when they're all already loaded", async () => {
    // Arrange.
    // Make it look like the thumbnail is already loaded.
    const imageId: string = faker.datatype.uuid();
    const state = fakeState();
    state.imageView.ids = [imageId];
    state.imageView.entities[imageId] = fakeArtifactEntity(true);
    const store = mockStoreCreator(state);

    // Act.
    await thunkLoadThumbnails([imageId])(
      store.dispatch,
      store.getState as () => RootState,
      {}
    );

    // Assert.
    // It should not have loaded the thumbnail.
    expect(mockLoadThumbnail).not.toBeCalled();

    // It should not have dispatched any actions.
    const actions = store.getActions();
    expect(actions).toHaveLength(0);
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
    const imageId: string = faker.datatype.uuid();
    const state = fakeState();
    state.imageView.ids = [imageId];
    state.imageView.entities[imageId] = fakeArtifactEntity(undefined, false);
    const store = mockStoreCreator(state);

    // Act.
    await thunkLoadImage(imageId)(store.dispatch, store.getState, {});

    // Assert.
    // It should have loaded the image.
    expect(mockLoadImage).toBeCalledTimes(1);

    // It should have dispatched the lifecycle actions.
    const actions = store.getActions();
    expect(actions).toHaveLength(2);

    const pendingAction = actions[0];
    expect(pendingAction.type).toEqual(thunkLoadImage.pending.type);

    const fulfilledAction = actions[1];
    expect(fulfilledAction.type).toEqual(thunkLoadImage.fulfilled.type);
    expect(fulfilledAction.payload.imageId).toEqual(imageId);
    expect(fulfilledAction.payload.imageUrl).toEqual(imageUrl);
  });

  it("does not reload an image that is already loaded", async () => {
    // Arrange.
    // Make it look like the image is already loaded.
    const imageId: string = faker.datatype.uuid();
    const state = fakeState();
    state.imageView.ids = [imageId];
    state.imageView.entities[imageId] = fakeArtifactEntity(undefined, true);
    const store = mockStoreCreator(state);

    // Act.
    await thunkLoadImage(imageId)(store.dispatch, store.getState, {});

    // Assert.
    // It should not have loaded the image.
    expect(mockLoadImage).not.toBeCalled();

    // It should not have dispatched any actions.
    expect(store.getActions()).toHaveLength(0);
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
    const store = mockStoreCreator(state);

    // Act.
    await thunkLoadMetadata([unloadedImageId, loadedImageId])(
      store.dispatch,
      store.getState,
      {}
    );

    // Assert.
    // It should have loaded the metadata.
    expect(mockGetMetadata).toBeCalledTimes(1);

    // It should have dispatched the lifecycle actions.
    const actions = store.getActions();
    expect(actions).toHaveLength(2);

    const pendingAction = actions[0];
    expect(pendingAction.type).toEqual("thumbnailGrid/loadMetadata/pending");

    const fulfilledAction = actions[1];
    expect(fulfilledAction.type).toEqual(
      "thumbnailGrid/loadMetadata/fulfilled"
    );
    expect(fulfilledAction.payload.imageIds).toEqual([
      loadedImageId,
      unloadedImageId,
    ]);
    expect(fulfilledAction.payload.metadata).toEqual([
      loadedImage.metadata,
      newMetadata,
    ]);
  });

  it("does not reload metadata that is already loaded", async () => {
    // Arrange.
    // Make it look like the image metadata is already loaded.
    const imageId: string = faker.datatype.uuid();
    const state = fakeState();
    state.imageView.ids = [imageId];
    state.imageView.entities[imageId] = fakeArtifactEntity(true, true);
    const store = mockStoreCreator(state);

    // Act.
    await thunkLoadMetadata([imageId])(store.dispatch, store.getState, {});

    // Assert.
    // It should not have loaded the metadata.
    expect(mockGetMetadata).not.toBeCalled();

    // It should not have dispatched any actions.
    expect(store.getActions()).toHaveLength(0);
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

      const store = mockStoreCreator(state);

      // Act.
      await thunkBulkDownloadSelected()(store.dispatch, store.getState, {});

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

      const actions = store.getActions();
      expect(actions).toHaveLength(3);

      // It should have dispatched the pending action first.
      const pendingAction = actions[0];
      expect(pendingAction.type).toEqual(
        thunkBulkDownloadSelected.typePrefix + "/pending"
      );

      // It should have dispatched an action to clear the selected items.
      const clearAction = actions[1];
      expect(clearAction.type).toEqual(
        thumbnailGridSlice.actions.selectImages.type
      );
      // It should clear only the items that were selected.
      expect(clearAction.payload.imageIds).toHaveLength(2);
      expect(clearAction.payload.imageIds).toContainEqual(imageView.ids[0]);
      expect(clearAction.payload.imageIds).toContainEqual(imageView.ids[1]);
      expect(clearAction.payload.select).toEqual(false);

      // It should have dispatched the fulfilled action.
      const fulfilledAction = actions[2];
      expect(fulfilledAction.type).toEqual(
        thunkBulkDownloadSelected.typePrefix + "/fulfilled"
      );
    });

    it("does not try to perform two bulk downloads at once", async () => {
      // Arrange.
      const imageView = state.imageView;
      // Make it look like a bulk download is already running.
      imageView.bulkDownloadState = RequestState.LOADING;

      const store = mockStoreCreator(state);

      // Act.
      await thunkBulkDownloadSelected()(store.dispatch, store.getState, {});

      // Assert.
      // It should not have run any downloads.
      expect(mockDownloadArtifactZip).not.toBeCalled();
    });

    it("updates the metadata of selected images", async () => {
      // Arrange.
      const metadata = fakeImageMetadata();

      const store = mockStoreCreator(state);
      // It doesn't actually have to return anything.
      mockBatchUpdateMetadata.mockResolvedValue(undefined);

      // Act.
      const result = await thunkUpdateSelectedMetadata(metadata)(
        store.dispatch,
        store.getState,
        {}
      );

      // Assert.
      const actions = store.getActions();
      expect(actions).toHaveLength(6);

      // It should have dispatched the pending action.
      const updatePendingAction = actions[0];
      expect(updatePendingAction.type).toEqual(
        thunkUpdateSelectedMetadata.pending.type
      );

      // It should have closed the editing dialog.
      const closeDialogAction = actions[1];
      expect(closeDialogAction).toBeDefined();
      expect(closeDialogAction.payload).toBe(false);

      // It should have forced a reload of the thumbnail view.
      const clearThumbnailsAction = actions[2];
      expect(clearThumbnailsAction.type).toEqual(clearThumbnails.type);
      const clearImagesAction = actions[3];
      expect(clearImagesAction.type).toEqual(clearFullSizedImages.type);
      const clearViewAction = actions[4];
      expect(clearViewAction.type).toEqual(clearImageView.type);

      // It should have dispatched the fulfilled action.
      const updateFulfilledAction = actions[5];
      expect(updateFulfilledAction.type).toEqual(
        thunkUpdateSelectedMetadata.fulfilled.type
      );
      expect(updateFulfilledAction.payload).toEqual(selectedIds);

      // It should have updated the metadata.
      expect(mockBatchUpdateMetadata).toHaveBeenCalledWith(
        metadata,
        selectedIds.map((id) => state.imageView.entities[id]?.backendId)
      );

      // It should have returned the IDs of the updated images.
      expect(result.payload).toEqual(selectedIds);
    });

    describe("thunkDeleteSelected", () => {
      it("should delete selected images and return their IDs", async () => {
        // Arrange
        const store = mockStoreCreator(state);
        // It doesn't actually have to return anything.
        mockDeleteImages.mockResolvedValue(undefined);

        // Act
        const result = await thunkDeleteSelected()(
          store.dispatch,
          store.getState,
          {}
        );

        // Assert
        const actions = store.getActions();
        expect(actions).toHaveLength(4);

        // It should have dispatched the pending action.
        const deletePendingAction = actions[0];
        expect(deletePendingAction.type).toEqual(
          thunkDeleteSelected.pending.type
        );

        // It should have cleared any loaded images.
        const imageClearAction = actions[1];
        expect(imageClearAction.type).toEqual(clearFullSizedImages.type);
        expect(imageClearAction.payload).toEqual(selectedIds);

        // It should have cleared any loaded thumbnails.
        const thumbnailClearAction = actions[2];
        expect(thumbnailClearAction.type).toEqual(clearThumbnails.type);
        expect(thumbnailClearAction.payload).toEqual(selectedIds);

        // It should have dispatched the fulfilled action.
        const deleteFullfilledAction = actions[3];
        expect(deleteFullfilledAction.type).toEqual(
          thunkDeleteSelected.fulfilled.type
        );
        expect(deleteFullfilledAction.payload).toEqual(selectedIds);

        // It should have deleted the selected images.
        const selectedBackendIds = selectedIds.map(
          (id) => state.imageView.entities[id]?.backendId.id
        );
        expect(mockDeleteImages).toHaveBeenCalledWith(selectedBackendIds);
        // It should have returned the IDs of the images that it deleted.
        expect(result.payload).toEqual(selectedIds);
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

        const store = mockStoreCreator(state);

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

    it("can export selected images with thunkExportSelected", () => {
      // Arrange.
      const store = mockStoreCreator(state);
      const exportedUrl = faker.internet.url();
      mockMakeArtifactUrlList.mockReturnValue(exportedUrl);

      // Act.
      thunkExportSelected()(
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

      const actions = store.getActions();
      expect(actions).toHaveLength(2);

      // It should have set the URL in the state.
      const setExportedImagesUrlAction = actions[0];
      expect(setExportedImagesUrlAction.type).toEqual(
        setExportedImagesUrl.type
      );
      expect(setExportedImagesUrlAction.payload).toEqual(exportedUrl);

      // It should have de-selected all the images.
      const thunkSelectAllAction = actions[1];
      expect(thunkSelectAllAction.type).toEqual(selectImages.type);
      expect(thunkSelectAllAction.payload).toEqual({
        imageIds: expect.anything(),
        select: false,
      });
    });

    it("can clear exported images URL with thunkClearExportedImages", () => {
      // Arrange.
      const exportedUrl = faker.internet.url();

      // Create the fake state.
      state.imageView.exportedImagesUrl = exportedUrl;

      const store = mockStoreCreator(state);

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

      const actions = store.getActions();
      expect(actions).toHaveLength(1);

      // It should have cleared the URL in the state.
      const setExportedImagesUrlAction = actions[0];
      expect(setExportedImagesUrlAction.type).toEqual(
        setExportedImagesUrl.type
      );
      expect(setExportedImagesUrlAction.payload).toEqual(null);
    });

    it("does nothing if the exported images URL is null", () => {
      // Arrange.
      const store = mockStoreCreator(fakeState());

      // Act.
      thunkClearExportedImages()(
        store.dispatch,
        store.getState as () => RootState,
        {}
      );

      // Assert.
      // It should not have revoked anything.
      expect(URL.revokeObjectURL).not.toHaveBeenCalled();

      const actions = store.getActions();
      expect(actions).toHaveLength(0);
    });
  });

  it("creates a doAutocomplete action", async () => {
    // Arrange.
    // Make it look lit it got some autocomplete suggestions.
    const suggestions = fakeSuggestions();
    mockRequestAutocomplete.mockResolvedValue(suggestions);

    // Initialize the fake store with valid state.
    const state = fakeState();
    const store = mockStoreCreator(state);

    // Act.
    const searchString = faker.lorem.sentence();
    const numSuggestions = faker.datatype.number();
    await thunkDoAutocomplete({
      searchString: searchString,
      numSuggestions: numSuggestions,
    })(store.dispatch, store.getState, {});

    // Assert.
    // It should have performed the autocomplete request.
    expect(mockRequestAutocomplete).toBeCalledWith(
      searchString,
      numSuggestions
    );

    // It should have dispatched the lifecycle actions.
    const actions = store.getActions();
    expect(actions).toHaveLength(2);

    const pendingAction = actions[0];
    expect(pendingAction.type).toEqual(
      thunkDoAutocomplete.typePrefix + "/pending"
    );

    const fulfilledAction = actions[1];
    expect(fulfilledAction.type).toEqual(
      thunkDoAutocomplete.typePrefix + "/fulfilled"
    );
    expect(fulfilledAction.payload).toEqual({
      searchString: searchString,
      autocompleteSuggestions: suggestions,
    });
  });

  it("can start queries with thunkTextSearch", () => {
    // Arrange.
    // Make it look like we can generate queries.
    const queries = [fakeImageQuery(), fakeImageQuery()];
    mockQueriesFromSearchString.mockReturnValue(queries);

    // Initialize the fake store with valid state.
    const state = fakeState();
    const store = mockStoreCreator(state);

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

    // It should have dispatched the query action.
    const actions = store.getActions();
    expect(actions).toHaveLength(4);

    // Initial actions should just be clearing the state.
    expect(actions[0].type).toEqual(clearThumbnails.type);
    expect(actions[1].type).toEqual(clearFullSizedImages.type);
    expect(actions[2].type).toEqual(clearImageView.type);

    const startQueryAction = actions[3];
    expect(startQueryAction.type).toEqual(thunkStartNewQuery.pending.type);

    expect(startQueryAction.meta.arg).toEqual({
      query: queries,
    });
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
      const store = mockStoreCreator(state);

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
        expect(mockRevokeObjectUrl).not.toBeCalled();
      }

      // It should have dispatched the action.
      const actions = store.getActions();
      expect(actions).toHaveLength(1);

      const clearAction = actions[0];
      expect(clearAction.type).toEqual(
        thumbnailGridSlice.actions.clearFullSizedImages.type
      );
      expect(clearAction.payload).toEqual(imageLoaded ? images.ids : []);
    }
  );

  it("Does nothing when no image is passed to clearFullSizedImages", () => {
    // Arrange.
    const store = mockStoreCreator(fakeState());

    // Act.
    thunkClearFullSizedImages([undefined])(
      store.dispatch,
      store.getState as () => RootState,
      {}
    );

    // Assert.
    // It should have done nothing.
    expect(mockRevokeObjectUrl).not.toBeCalled();
    const actions = store.getActions();
    expect(actions).toHaveLength(1);

    const clearAction = actions[0];
    expect(clearAction.type).toEqual(
      thumbnailGridSlice.actions.clearFullSizedImages.type
    );
    expect(clearAction.payload).toEqual([]);
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
      const store = mockStoreCreator(state);

      // Act.
      thunkClearThumbnails(images.ids)(
        store.dispatch,
        store.getState as () => RootState,
        {}
      );

      // Assert.
      if (thumbnailLoaded) {
        // It should have released the loaded thumbnails.
        expect(mockRevokeObjectUrl).toBeCalledTimes(images.ids.length);
        for (const id of images.ids) {
          expect(mockRevokeObjectUrl).toBeCalledWith(
            images.entities[id].thumbnailUrl
          );
        }
      } else {
        expect(mockRevokeObjectUrl).not.toBeCalled();
      }

      // It should have dispatched the action.
      const actions = store.getActions();
      expect(actions).toHaveLength(1);

      const clearAction = actions[0];
      expect(clearAction.type).toEqual(
        thumbnailGridSlice.actions.clearThumbnails.type
      );
      expect(clearAction.payload).toEqual(thumbnailLoaded ? images.ids : []);
    }
  );

  it("Does nothing when no image is passed to clearThumbnails", () => {
    // Arrange.
    const store = mockStoreCreator(fakeState());

    // Act.
    thunkClearThumbnails([undefined])(
      store.dispatch,
      store.getState as () => RootState,
      {}
    );

    // Assert.
    // It should have done nothing.
    expect(mockRevokeObjectUrl).not.toBeCalled();
    const actions = store.getActions();
    expect(actions).toHaveLength(1);

    const clearAction = actions[0];
    expect(clearAction.type).toEqual(
      thumbnailGridSlice.actions.clearThumbnails.type
    );
    expect(clearAction.payload).toEqual([]);
  });

  it("can clear all the images with thunkClearImageView", () => {
    // Arrange.
    const images = fakeArtifactEntities(undefined, true, true);
    const state = fakeState();
    state.imageView.ids = images.ids;
    state.imageView.entities = images.entities;
    const store = mockStoreCreator(state);

    // Act.
    thunkClearImageView()(
      store.dispatch,
      store.getState as () => RootState,
      {}
    );

    // Assert.
    // It should have dispatched the clearThumbnail and clearFullSizeImages actions.
    const actions = store.getActions();
    expect(actions).toHaveLength(3);

    const clearThumbnailAction = actions[0];
    expect(clearThumbnailAction.type).toEqual(
      thumbnailGridSlice.actions.clearThumbnails.type
    );
    expect(clearThumbnailAction.payload).toEqual(images.ids);

    const clearFullSizeAction = actions[1];
    expect(clearFullSizeAction.type).toEqual(
      thumbnailGridSlice.actions.clearFullSizedImages.type
    );
    expect(clearFullSizeAction.payload).toEqual(images.ids);

    const clearImageViewAction = actions[2];
    expect(clearImageViewAction.type).toEqual(
      thumbnailGridSlice.actions.clearImageView.type
    );
    // Don't clear the current query.
    expect(clearImageViewAction.payload).toEqual({ preserveQuery: true });
  });

  each([
    ["all changed", true],
    ["none changed", false],
  ]).it(
    "can select/deselect all the images (%s)",
    (_, changeSelection: boolean) => {
      // Arrange.
      const select = faker.datatype.boolean();
      // Make it look like there are various images.
      const images = fakeArtifactEntities();
      // Make it look like none are selected.
      for (const id of images.ids) {
        images.entities[id].isSelected = changeSelection ? !select : select;
      }

      const state = fakeState();
      state.imageView.ids = images.ids;
      state.imageView.entities = images.entities;

      const store = mockStoreCreator(state);

      // Act.
      thunkSelectAll(select)(
        store.dispatch,
        store.getState as () => RootState,
        {}
      );

      // Assert.
      // It should have dispatched the action.
      const actions = store.getActions();
      if (changeSelection) {
        expect(actions).toHaveLength(1);

        const selectAction = actions[0];
        expect(selectAction.type).toEqual(
          thumbnailGridSlice.actions.selectImages.type
        );
        expect(selectAction.payload).toEqual({
          imageIds: state.imageView.ids,
          select: select,
        });
      } else {
        // In this case, it should have changed nothing.
        expect(actions).toHaveLength(0);
      }
    }
  );

  it("can select/deselect multiple images", () => {
    // Arrange.
    const select = faker.datatype.boolean();
    // Make it look like there are various images.
    const images = fakeArtifactEntities(50);

    const state = fakeState();
    state.imageView.ids = images.ids;
    state.imageView.entities = images.entities;

    const store = mockStoreCreator(state);

    // Act.
    thunkSelectImages({ imageIds: images.ids, select: select })(
      store.dispatch,
      store.getState as () => RootState,
      {}
    );

    // Assert.
    // It should have dispatched the action.
    const actions = store.getActions();
    expect(actions).toHaveLength(1);

    const selectAction = actions[0];
    expect(selectAction.type).toEqual(
      thumbnailGridSlice.actions.selectImages.type
    );

    // It should have only changed the ones that needed to be changed.
    const idsToUpdate = state.imageView.ids.filter(
      (id) => state.imageView.entities[id]?.isSelected != select
    );
    expect(selectAction.payload).toEqual({
      imageIds: idsToUpdate,
      select: select,
    });
  });

  each([
    ["is not registered", undefined],
    ["is registered", fakeArtifactEntity()],
  ]).it(
    "can set a new image to show details for when the image %s",
    (_, imageEntity?: ArtifactEntity) => {
      // Arrange.
      // Create a fake image.
      const backendId =
        imageEntity?.backendId ?? fakeTypedObjectRef(ObjectType.IMAGE);
      const frontendId = createArtifactEntityId(backendId.id);

      const state = fakeState();
      if (imageEntity) {
        // Make it look lie this image exists.
        state.imageView.ids = [frontendId];
        state.imageView.entities[frontendId] = imageEntity;
      }
      const store = mockStoreCreator(state);

      // Act.
      thunkShowDetails(backendId)(
        store.dispatch,
        store.getState as () => RootState,
        {}
      );

      // Assert.
      // It should have dispatched actions.
      const actions = store.getActions();
      expect(actions).toHaveLength(imageEntity ? 1 : 2);

      if (!imageEntity) {
        // There will be one extra action to register the artifact
        const registerAction = actions[0];
        expect(registerAction.type).toEqual(addArtifacts.type);
        expect(registerAction.payload).toEqual([backendId]);
      }

      // There should be an action to update which image we are showing
      // details of.
      const detailsAction = actions[actions.length - 1];
      expect(detailsAction.type).toEqual(showDetails.type);
      expect(detailsAction.payload).toEqual(frontendId);
    }
  );
});

describe("thumbnail-grid-slice reducers", () => {
  beforeEach(() => {
    // Set the faker seed.
    faker.seed(1337);
  });

  it("handles an addArtifacts action", () => {
    // Arrange.
    const state: ImageViewState = fakeState().imageView;
    const backendId = fakeTypedObjectRef();

    // Make it look like we can get a preview URL.
    const fakePreviewUrl = faker.internet.url();
    mockGetPreviewVideoUrl.mockReturnValue(fakePreviewUrl);
    // Make it look like we can get a streamable URL.
    const fakeStreamableUrl = faker.internet.url();
    mockGetStreamableVideoUrl.mockReturnValue(fakeStreamableUrl);

    // Act.
    const newState = thumbnailGridSlice.reducer(
      state,
      addArtifacts([backendId])
    );

    // Assert.
    // It should have added a new entity.
    expect(newState.ids.length).toEqual(1);
    expect(newState.entities[newState.ids[0]]?.backendId).toEqual(backendId);
    // It should have used the preview URL.
    expect(newState.entities[newState.ids[0]]?.previewUrl).toEqual(
      fakePreviewUrl
    );
    // It should have used the streamable URL.
    expect(newState.entities[newState.ids[0]]?.streamableUrl).toEqual(
      fakeStreamableUrl
    );
  });

  it("handles a clearFullSizedImages action", () => {
    // Arrange.
    // Make it look like one image is loaded and one is not.
    const loadedImage = fakeArtifactEntity(undefined, true);
    const unloadedImage = fakeArtifactEntity(undefined, false);
    const loadedImageId = createArtifactEntityId(loadedImage.backendId.id);
    const unloadedImageId = createArtifactEntityId(unloadedImage.backendId.id);

    const state: RootState = fakeState();
    state.imageView.ids = [loadedImageId, unloadedImageId];
    state.imageView.entities[loadedImageId] = loadedImage;
    state.imageView.entities[unloadedImageId] = unloadedImage;

    // Act.
    const newImageState = thumbnailGridSlice.reducer(
      state.imageView,
      clearFullSizedImages([loadedImageId, unloadedImageId])
    );

    // Assert.
    const newState = fakeState();
    newState.imageView = newImageState;

    // It should have removed the image.
    const imageEntities = thumbnailGridSelectors.selectAll(newState);
    expect(imageEntities).toHaveLength(2);
    for (const image of imageEntities) {
      expect(image.artifactUrl).toBeNull();
      expect(image.imageStatus).toEqual(ArtifactStatus.NOT_LOADED);
    }
  });

  it("handles a clearThumbnails action", () => {
    // Arrange.
    // Make it look like one image is loaded and one is not.
    const loadedImage = fakeArtifactEntity(true);
    const unloadedImage = fakeArtifactEntity(false);
    const loadedImageId = createArtifactEntityId(loadedImage.backendId.id);
    const unloadedImageId = createArtifactEntityId(unloadedImage.backendId.id);

    const state: RootState = fakeState();
    state.imageView.ids = [loadedImageId, unloadedImageId];
    state.imageView.entities[loadedImageId] = loadedImage;
    state.imageView.entities[unloadedImageId] = unloadedImage;
    state.imageView.numThumbnailsLoaded = 1;

    // Act.
    const newImageState = thumbnailGridSlice.reducer(
      state.imageView,
      clearThumbnails([loadedImageId])
    );

    // Assert.
    const newState = fakeState();
    newState.imageView = newImageState;

    // It should have removed the image.
    const imageEntities = thumbnailGridSelectors.selectAll(newState);
    expect(imageEntities).toHaveLength(2);
    for (const image of imageEntities) {
      expect(image.thumbnailUrl).toBeNull();
      expect(image.thumbnailStatus).toEqual(ArtifactStatus.NOT_LOADED);
    }

    // It should have updated the counter for the number of loaded images.
    expect(newState.imageView.numThumbnailsLoaded).toEqual(0);
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

  it("handles a showDetails action", () => {
    // Arrange.
    const state = fakeState().imageView;
    state.details.frontendId = null;

    const imageId = faker.datatype.uuid();

    // Act.
    const newState = thumbnailGridReducer(state, showDetails(imageId));

    // Assert.
    expect(newState.details.frontendId).toEqual(imageId);
  });

  it("handles a setExportedImagesUrl action", () => {
    // Arrange.
    const state: RootState = fakeState();
    const url = faker.internet.url();

    // Act.
    const newImageState = thumbnailGridSlice.reducer(
      state.imageView,
      setExportedImagesUrl(url)
    );

    // Assert.
    expect(newImageState.exportedImagesUrl).toEqual(url);
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

  it("handles a setVideoUrl action", () => {
    // Arrange.
    // Set up the state with the video.
    const state: RootState = fakeState();
    const entity = fakeArtifactEntity();
    entity.backendId.type = ObjectType.VIDEO;
    const entityId = createArtifactEntityId(entity.backendId.id);
    state.imageView.ids = [entityId];
    state.imageView.entities[entityId] = entity;

    const url = faker.internet.url();
    // Make it look like it can get the URL.
    mockGetArtifactUrl.mockReturnValue(url);

    // Act.
    const newImageState = thumbnailGridSlice.reducer(
      state.imageView,
      setVideoUrl(entityId)
    );

    // Assert.
    expect(newImageState.entities[entityId]?.artifactUrl).toEqual(url);
    expect(mockGetArtifactUrl).toBeCalledTimes(1);
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

  it("ignores VideoUrl actions if the entity is not a video", () => {
    // Arrange.
    const originalUrl = faker.internet.url();

    // Set up the state with an artifact.
    const state: RootState = fakeState();
    const entity = fakeArtifactEntity();
    entity.backendId.type = ObjectType.IMAGE;
    entity.artifactUrl = originalUrl;
    const entityId = createArtifactEntityId(entity.backendId.id);
    state.imageView.ids = [entityId];
    state.imageView.entities[entityId] = entity;

    const newUrl = faker.internet.url();
    // Make it look like it can get the URL.
    mockGetArtifactUrl.mockReturnValue(newUrl);

    // Act.
    let newImageState = thumbnailGridSlice.reducer(
      state.imageView,
      setVideoUrl(entityId)
    );
    newImageState = thumbnailGridSlice.reducer(
      newImageState,
      clearVideoUrl(entityId)
    );

    // Assert.
    // It should not actually have updated the URL.
    expect(newImageState.entities[entityId]?.artifactUrl).toEqual(originalUrl);
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

  it(`handles a ${thunkStartNewQuery.pending.type} action`, () => {
    // Arrange.
    const state: ImageViewState = fakeState().imageView;
    state.currentQueryState = RequestState.IDLE;

    // Act.
    const newState: ImageViewState = thumbnailGridReducer(state, {
      type: thunkStartNewQuery.pending.type,
    });

    // Assert.
    // It should have marked the query request as loading.
    expect(newState.currentQueryState).toEqual(RequestState.LOADING);
  });

  it(`handles a ${thunkStartNewQuery.fulfilled.type} action`, () => {
    // Arrange.
    const state: ImageViewState = fakeState().imageView;

    // Create a fake query.
    const query: ImageQuery = {};
    // Create a fake image to add to the state.
    const fakeImage: ObjectRef = {
      bucket: faker.lorem.word(),
      name: faker.datatype.uuid(),
    };

    // Create the action.
    const action = {
      type: thunkStartNewQuery.fulfilled.type,
      payload: {
        result: {
          imageIds: [fakeImage],
          pageNum: 1,
          isLastPage: faker.datatype.boolean(),
        },
        query: query,
        options: {
          resultsPerPage: faker.datatype.number(),
          pageNum: faker.datatype.number(),
        },
      },
    };

    // Act.
    const newState: ImageViewState = thumbnailGridReducer(state, action);

    // Assert.
    // It should have marked the query as succeeded.
    expect(newState.currentQueryState).toEqual(RequestState.SUCCEEDED);

    // We need the full state to use selectors.
    const newRootState = fakeState();
    newRootState.imageView = newState;

    // The query should have been preserved so that we can re-run it.
    expect(newState.currentQuery).toEqual(query);
    expect(newState.currentQueryOptions).toEqual(action.payload.options);
  });

  it(`handles a ${thunkContinueQuery.pending.type} action`, () => {
    // Arrange.
    const state: ImageViewState = fakeState().imageView;
    // The state will probably be SUCCEEDED in practice since we have
    // run another query before.
    state.currentQueryState = RequestState.SUCCEEDED;

    // Act.
    const newState: ImageViewState = thumbnailGridReducer(state, {
      type: thunkContinueQuery.pending.type,
    });

    // Assert.
    // It should have marked the query request as loading.
    expect(newState.currentQueryState).toEqual(RequestState.LOADING);
  });

  it(`handles a ${thunkContinueQuery.fulfilled.type} action`, () => {
    // Arrange.
    const state: ImageViewState = fakeState().imageView;

    // Create a fake query.
    state.currentQuery = [{}];
    state.currentQueryState = RequestState.LOADING;
    // Create a fake image to add to the state.
    const fakeImage: ObjectRef = {
      bucket: faker.lorem.word(),
      name: faker.datatype.uuid(),
    };

    // Create the action.
    const pageNum = faker.datatype.number();
    const action = {
      type: thunkContinueQuery.fulfilled.type,
      payload: {
        pageNum: pageNum,
        result: {
          imageIds: [fakeImage],
          pageNum: pageNum,
          isLastPage: faker.datatype.boolean(),
        },
      },
    };

    // Act.
    const newState: ImageViewState = thumbnailGridReducer(state, action);

    // Assert.
    // It should have marked the query as succeeded.
    expect(newState.currentQueryState).toEqual(RequestState.SUCCEEDED);

    // We need the full state to use selectors.
    const newRootState = fakeState();
    newRootState.imageView = newState;

    // It should have updated the page number.
    expect(newState.currentQueryOptions.pageNum).toEqual(pageNum);
  });

  it(`handles a ${thunkBulkDownloadSelected.pending.type} action`, () => {
    // Arrange.
    const state = fakeState().imageView;
    state.bulkDownloadState = RequestState.IDLE;

    // Act.
    const newState = thumbnailGridReducer(state, {
      type: thunkBulkDownloadSelected.pending.type,
    });

    // Assert.
    // It should have marked the bulk download as running.
    expect(newState.bulkDownloadState).toEqual(RequestState.LOADING);
  });

  it(`handles a ${thunkUpdateSelectedMetadata.pending} action`, () => {
    // Arrange.
    const state = fakeState().imageView;
    state.metadataEditingState = RequestState.IDLE;

    // Act.
    const newState = thumbnailGridReducer(state, {
      type: thunkUpdateSelectedMetadata.pending.type,
    });

    // Assert.
    // It should have marked the bulk download as running.
    expect(newState.metadataEditingState).toEqual(RequestState.LOADING);
  });

  it(`handles a ${thunkUpdateSelectedMetadata.fulfilled} action`, () => {
    // Arrange.
    const state: ImageViewState = fakeState().imageView;

    // Images that we are updating metadata for.
    const images = fakeArtifactEntities(undefined);
    state.ids = images.ids;
    state.entities = images.entities;

    // Create fake updated image IDs.
    const updatedIds = images.ids.slice(0, 2);
    // Create fake metadata.
    const metadata = fakeImageMetadata();
    // Create the action.
    const action = {
      type: thunkUpdateSelectedMetadata.fulfilled.type,
      payload: updatedIds,
      meta: { arg: metadata },
    };

    // Act.
    const newState: ImageViewState = thumbnailGridReducer(state, action);

    // Assert.
    // It should have updated the metadata editing state to SUCCEEDED.
    expect(newState.metadataEditingState).toEqual(RequestState.SUCCEEDED);

    // It should have updated the metadata for the selected images.
    for (const id of updatedIds) {
      const imageEntity = newState.entities[id];
      expect(imageEntity?.metadata).toEqual(metadata);
    }
  });

  it(`handles a ${thunkBulkDownloadSelected.fulfilled.type} action`, () => {
    // Arrange.
    const state = fakeState().imageView;
    state.bulkDownloadState = RequestState.LOADING;

    // Act.
    const newState = thumbnailGridReducer(state, {
      type: thunkBulkDownloadSelected.fulfilled.type,
    });

    // Assert.
    // It should have marked the bulk download as complete.
    expect(newState.bulkDownloadState).toEqual(RequestState.SUCCEEDED);
  });

  it(`handles a ${thunkDeleteSelected.pending.type} action`, () => {
    // Arrange.
    const state = fakeState().imageView;

    // Act.
    const newState = thumbnailGridReducer(state, {
      type: thunkDeleteSelected.pending.type,
    });

    // Assert.
    // It should have changed the imageDeletionState to loading.
    const expectedState = {
      ...state,
      imageDeletionState: RequestState.LOADING,
    };
    expect(newState).toEqual(expectedState);
  });

  it(`handles a ${thunkDeleteSelected.fulfilled.type} action`, () => {
    // Arrange.
    // Make it look like there are various images.
    const image1 = fakeArtifactEntity();
    const image2 = fakeArtifactEntity();
    image1.isSelected = true;
    image2.isSelected = true;

    // Create the fake state.
    const imageIds = [image1, image2].map((e) =>
      createArtifactEntityId(e.backendId.id)
    );
    const state = fakeState().imageView;
    state.ids = imageIds;
    state.entities[imageIds[0]] = image1;
    state.entities[imageIds[1]] = image2;
    state.numItemsSelected = 2;

    // Act.
    const newState = thumbnailGridReducer(state, {
      type: thunkDeleteSelected.fulfilled.type,
      payload: imageIds,
    });

    // Assert.
    // It should have changed the imageDeletionState to "succeeded".
    // It should have removed the deleted images from the frontend state.
    // It should have reset the number of selected items to 0.
    const expectedState = {
      ...state,
      imageDeletionState: RequestState.SUCCEEDED,
      ids: [],
      entities: {},
      numItemsSelected: 0,
    };
    expect(newState).toEqual(expectedState);
  });

  it(`handles a ${thunkDoAutocomplete.pending.type} action`, () => {
    // Arrange.
    const state: ImageViewState = fakeState().imageView;
    state.search.queryState = RequestState.IDLE;
    state.search.searchString = "";

    // Act.
    const searchString = faker.lorem.words();
    const newState: ImageViewState = thumbnailGridReducer(state, {
      type: thunkDoAutocomplete.pending.type,
      meta: { arg: { searchString: searchString } },
    });

    // Assert.
    // It should have marked the query request as loading.
    expect(newState.search.queryState).toEqual(RequestState.LOADING);
    // It should have saved the search string.
    expect(newState.search.searchString).toEqual(searchString);
  });

  it(`handles a ${thunkDoAutocomplete.fulfilled.type} action`, () => {
    // Arrange.
    const state: ImageViewState = fakeState().imageView;
    state.search.queryState = RequestState.LOADING;
    state.search.searchString = faker.lorem.words();
    state.search.autocompleteSuggestions.menu = AutocompleteMenu.NONE;
    state.search.autocompleteSuggestions.textCompletions = [];

    // Act.
    const suggestions = fakeSuggestions();
    const newState: ImageViewState = thumbnailGridReducer(state, {
      type: thunkDoAutocomplete.fulfilled.type,
      payload: {
        autocompleteSuggestions: suggestions,
      },
    });

    // Assert.
    // It should have marked the query request as succeeded.
    expect(newState.search.queryState).toEqual(RequestState.SUCCEEDED);
    // It should have saved the suggestions.
    expect(newState.search.autocompleteSuggestions).toEqual(suggestions);
  });

  it("handles a thumbnailGrid/loadThumbnailsChunk/pending action", () => {
    // Arrange.
    const state: ImageViewState = fakeState().imageView;

    // Images that we are loading thumbnails for.
    const images = fakeArtifactEntities();
    state.ids = images.ids;
    state.entities = images.entities;

    // Act.
    const newState: ImageViewState = thumbnailGridReducer(state, {
      type: "thumbnailGrid/loadThumbnailsChunk/pending",
      meta: {
        arg: images.ids,
      },
    });

    // Assert.
    // It should have updated the loading status.
    for (const id of images.ids) {
      expect(newState.entities[id]?.thumbnailStatus).toEqual(
        ArtifactStatus.LOADING
      );
    }
  });

  it("handles a thumbnailGrid/loadThumbnailsChunk/fulfilled action", () => {
    // Arrange.
    const state: ImageViewState = fakeState().imageView;

    // Images that we are loading thumbnails for.
    const images = fakeArtifactEntities(undefined);
    state.ids = images.ids;
    state.entities = images.entities;

    // Create fake loaded image data.
    const imageInfo = images.ids.map((id) => ({
      imageId: id,
      imageUrl: faker.image.dataUri(),
    }));
    // Create the action.
    const action = {
      meta: {
        arg: images.ids,
      },
      type: "thumbnailGrid/loadThumbnailsChunk/fulfilled",
      payload: imageInfo,
    };

    // Act.
    const newState: ImageViewState = thumbnailGridReducer(state, action);

    // Assert.
    // It should have updated the entities for the images.
    for (let i = 0; i < images.ids.length; ++i) {
      const imageId = images.ids[i];
      const imageEntity = newState.entities[imageId];
      expect(imageEntity?.thumbnailStatus).toEqual(ArtifactStatus.LOADED);
      expect(imageEntity?.thumbnailUrl).toEqual(imageInfo[i].imageUrl);
    }

    // It should have updated the tracker for the number of loaded thumbnails.
    expect(newState.numThumbnailsLoaded).toEqual(state.ids.length);
  });

  it(`handles a ${thunkLoadImage.pending.type} action`, () => {
    // Arrange.
    const state: ImageViewState = fakeState().imageView;

    // Image IDs that we are loading metadata for.
    const imageEntity = fakeArtifactEntity();
    const imageId = createArtifactEntityId(imageEntity.backendId.id);
    state.ids = [imageId];
    state.entities[imageId] = imageEntity;

    // Act.
    const newState: ImageViewState = thumbnailGridReducer(state, {
      type: thunkLoadImage.pending,
      meta: {
        arg: imageId,
      },
    });

    // Assert.
    // It should have updated the loading status.
    expect(newState.entities[imageId]?.imageStatus).toEqual(
      ArtifactStatus.LOADING
    );
  });

  it(`handles a ${thunkLoadImage.fulfilled.type} action`, () => {
    // Arrange.
    const state: ImageViewState = fakeState().imageView;

    // Fix up the state so it looks like we already have a loading image.
    const fakeEntity = fakeArtifactEntity(undefined, false);
    // In this case, the image ID has to be consistent with the backend ID
    // from the generated entity.
    const imageId: string = createArtifactEntityId(fakeEntity.backendId.id);
    state.ids = [imageId];
    state.entities[imageId] = fakeEntity;

    // Create fake loaded image data.
    const imageInfo = { imageId: imageId, imageUrl: faker.image.dataUri() };
    // Create the action.
    const action = {
      type: thunkLoadImage.fulfilled.type,
      payload: imageInfo,
    };

    // Act.
    const newState: ImageViewState = thumbnailGridReducer(state, action);

    // Assert.
    // It should have updated the entity for the image.
    const imageEntity = newState.entities[imageId];
    expect(imageEntity?.imageStatus).toEqual(ArtifactStatus.LOADED);
    expect(imageEntity?.artifactUrl).toEqual(imageInfo.imageUrl);
  });

  it(`handles a ${thunkLoadMetadata.pending.type} action`, () => {
    // Arrange.
    const state: ImageViewState = fakeState().imageView;
    state.metadataLoadingState = RequestState.IDLE;

    // Image IDs that we are loading metadata for.
    const imageEntities = [fakeArtifactEntity(), fakeArtifactEntity()];
    state.ids = imageEntities.map((e) =>
      createArtifactEntityId(e.backendId.id)
    );
    state.entities[state.ids[0]] = imageEntities[0];
    state.entities[state.ids[1]] = imageEntities[1];

    // Act.
    const newState: ImageViewState = thumbnailGridReducer(state, {
      type: thunkLoadMetadata.pending,
      meta: {
        arg: state.ids,
      },
    });

    // Assert.
    // It should have marked the metadata as loading.
    expect(newState.metadataLoadingState).toEqual(RequestState.LOADING);

    // It should have updated the loading status.
    for (const imageId of state.ids) {
      expect(newState.entities[imageId]?.metadataStatus).toEqual(
        ArtifactStatus.LOADING
      );
    }
  });

  it(`handles a ${thunkLoadMetadata.fulfilled.type} action`, () => {
    // Arrange.
    const state: ImageViewState = fakeState().imageView;

    // Fix up the state so it looks like we already have a thumbnail.
    const fakeEntity = fakeArtifactEntity(true);
    // In this case, the image ID has to be consistent with the backend ID
    // from the generated entity.
    const imageId: string = createArtifactEntityId(fakeEntity.backendId.id);
    state.ids = [imageId];
    state.entities[imageId] = fakeEntity;

    // Create the fake loaded metadata.
    const metadata: UavImageMetadata = {
      captureDate: faker.date.past().toISOString(),
    };
    const metadataInfo = { imageIds: [imageId], metadata: [metadata] };
    // Create the action.
    const action = {
      type: thunkLoadMetadata.typePrefix + "/fulfilled",
      payload: metadataInfo,
    };

    // Act.
    const newState: ImageViewState = thumbnailGridReducer(state, action);

    // Assert.
    // It should have updated the entity for the image.
    const imageEntity = newState.entities[imageId];
    expect(imageEntity?.metadata).toEqual(metadata);

    // It should have marked the metadata as loaded.
    expect(newState.metadataLoadingState).toEqual(RequestState.SUCCEEDED);
  });
});
