import configureStore, { MockStoreCreator } from "redux-mock-store";
import thumbnailGridReducer, {
  addArtifact,
  clearAutocomplete,
  clearFullSizedImage,
  clearImageView,
  createImageEntityId,
  selectImages,
  thumbnailGridSelectors,
  thumbnailGridSlice,
  thunkBulkDownloadSelected,
  thunkClearFullSizedImage,
  thunkContinueQuery,
  thunkDoAutocomplete,
  thunkLoadImage,
  thunkLoadMetadata,
  thunkLoadThumbnail,
  thunkStartNewQuery,
  thunkTextSearch,
} from "../thumbnail-grid-slice";
import {
  ImageQuery,
  ImageStatus,
  ImageViewState,
  RequestState,
  RootState,
} from "../types";
import thunk from "redux-thunk";
import {
  fakeImageEntity,
  fakeImageQuery,
  fakeObjectRef,
  fakeState,
  fakeSuggestions,
} from "./element-test-utils";
import { ObjectRef, QueryResponse, UavImageMetadata } from "mallard-api";
import each from "jest-each";
import {
  getMetadata,
  loadImage,
  loadThumbnail,
  queryImages,
} from "../api-client";
import {
  AutocompleteMenu,
  queriesFromSearchString,
  requestAutocomplete,
} from "../autocomplete";
import { downloadImageZip } from "../downloads";

// Require syntax must be used here due to an issue that prevents
// access to faker.seed() when using import syntax.
const faker = require("faker");

// Mock out the gateway API.
jest.mock("../api-client", () => ({
  queryImages: jest.fn(),
  loadThumbnail: jest.fn(),
  loadImage: jest.fn(),
  getMetadata: jest.fn(),
}));

const mockQueryImages = queryImages as jest.MockedFn<typeof queryImages>;
const mockLoadThumbnail = loadThumbnail as jest.MockedFn<typeof loadThumbnail>;
const mockLoadImage = loadImage as jest.MockedFn<typeof loadImage>;
const mockGetMetadata = getMetadata as jest.MockedFn<typeof getMetadata>;

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
  downloadImageZip: jest.fn(),
}));

const mockDownloadImageZip = downloadImageZip as jest.MockedFn<
  typeof downloadImageZip
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
        imageIds: [],
        pageNum: startPage ?? 1,
        isLastPage: true,
      };
      mockQueryImages.mockResolvedValue(queryResult);

      const store = mockStoreCreator({});
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

      // It should have dispatched the lifecycle actions.
      const actions = store.getActions();
      expect(actions).toHaveLength(2);

      const pendingAction = actions[0];
      expect(pendingAction.type).toEqual(thunkStartNewQuery.pending.type);

      const fulfilledAction = actions[1];
      expect(fulfilledAction.type).toEqual(thunkStartNewQuery.fulfilled.type);
      expect(fulfilledAction.payload.query).toEqual(queries);
      expect(fulfilledAction.payload.result).toEqual(queryResult);
      expect(fulfilledAction.payload.options).toMatchObject({
        pageNum: startPage ?? 1,
      });
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
    const store = mockStoreCreator(state);

    // Make it look like the query request succeeds.
    const queryResult: QueryResponse = {
      imageIds: [],
      pageNum: pageNum + 1,
      isLastPage: true,
    };
    mockQueryImages.mockResolvedValue(queryResult);

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

    // It should have dispatched the lifecycle actions.
    const actions = store.getActions();
    expect(actions).toHaveLength(2);

    const pendingAction = actions[0];
    expect(pendingAction.type).toEqual(thunkContinueQuery.pending.type);

    const fulfilledAction = actions[1];
    expect(fulfilledAction.type).toEqual(thunkContinueQuery.fulfilled.type);
    expect(fulfilledAction.payload.pageNum).toEqual(pageNum + 1);
    expect(fulfilledAction.payload.result).toEqual(queryResult);
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
    const rawImage = faker.image.cats(128, 128);
    mockLoadThumbnail.mockResolvedValue(rawImage);

    // Make it look like creatObjectURL produces a defined URL.
    const imageUrl = faker.image.dataUri();
    mockCreateObjectUrl.mockReturnValue(imageUrl);

    // Initialize the fake store with valid state.
    const imageId: string = faker.datatype.uuid();
    const state = fakeState();
    state.imageView.ids = [imageId];
    state.imageView.entities[imageId] = fakeImageEntity(false);
    const store = mockStoreCreator(state);

    // Act.
    await thunkLoadThumbnail(imageId)(store.dispatch, store.getState, {});

    // Assert.
    // It should have loaded the thumbnail.
    expect(mockLoadThumbnail).toBeCalledTimes(1);

    // It should have dispatched the lifecycle actions.
    const actions = store.getActions();
    expect(actions).toHaveLength(2);

    const pendingAction = actions[0];
    expect(pendingAction.type).toEqual(thunkLoadThumbnail.pending.type);

    const fulfilledAction = actions[1];
    expect(fulfilledAction.type).toEqual(thunkLoadThumbnail.fulfilled.type);
    expect(fulfilledAction.payload.imageId).toEqual(imageId);
    expect(fulfilledAction.payload.imageUrl).toEqual(imageUrl);
  });

  it("does not reload a thumbnail that is already loaded", async () => {
    // Arrange.
    // Make it look like the thumbnail is already loaded.
    const imageId: string = faker.datatype.uuid();
    const state = fakeState();
    state.imageView.ids = [imageId];
    state.imageView.entities[imageId] = fakeImageEntity(true);
    const store = mockStoreCreator(state);

    // Act.
    await thunkLoadThumbnail(imageId)(store.dispatch, store.getState, {});

    // Assert.
    // It should not have loaded the thumbnail.
    expect(mockLoadThumbnail).not.toBeCalled();

    // It should not have dispatched any actions.
    expect(store.getActions()).toHaveLength(0);
  });

  it("creates a loadImage action", async () => {
    // Arrange.
    // Make it look like the loadImage request succeeds.
    const rawImage = faker.image.cats(1920, 1080);
    mockLoadImage.mockResolvedValue(rawImage);

    // Make it look like creatObjectURL produces a defined URL.
    const imageUrl = faker.image.dataUri();
    mockCreateObjectUrl.mockReturnValue(imageUrl);

    // Initialize the fake store with valid state.
    const imageId: string = faker.datatype.uuid();
    const state = fakeState();
    state.imageView.ids = [imageId];
    state.imageView.entities[imageId] = fakeImageEntity(undefined, false);
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
    state.imageView.entities[imageId] = fakeImageEntity(undefined, true);
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
    const metadata: UavImageMetadata = {
      captureDate: faker.date.past().toISOString(),
    };
    mockGetMetadata.mockResolvedValue(metadata);

    // Initialize the fake store with valid state.
    const imageId: string = faker.datatype.uuid();
    const state = fakeState();
    state.imageView.ids = [imageId];
    state.imageView.entities[imageId] = fakeImageEntity(false, false);
    const store = mockStoreCreator(state);

    // Act.
    await thunkLoadMetadata([imageId])(store.dispatch, store.getState, {});

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
    expect(fulfilledAction.payload.imageIds).toEqual([imageId]);
    expect(fulfilledAction.payload.metadata).toEqual([metadata]);
  });

  it("does not reload metadata that is already loaded", async () => {
    // Arrange.
    // Make it look like the image metadata is already loaded.
    const imageId: string = faker.datatype.uuid();
    const state = fakeState();
    state.imageView.ids = [imageId];
    state.imageView.entities[imageId] = fakeImageEntity(true, true);
    const store = mockStoreCreator(state);

    // Act.
    await thunkLoadMetadata([imageId])(store.dispatch, store.getState, {});

    // Assert.
    // It should not have loaded the metadata.
    expect(mockGetMetadata).not.toBeCalled();

    // It should not have dispatched any actions.
    expect(store.getActions()).toHaveLength(0);
  });

  it("creates a BulkDownloadSelected action", async () => {
    // Arrange.
    // Make it look like some items are selected.
    const state = fakeState();
    const imageView = state.imageView;
    const selectedImage1 = fakeImageEntity();
    const selectedImage2 = fakeImageEntity();
    selectedImage1.isSelected = true;
    selectedImage2.isSelected = true;
    const unselectedImage = fakeImageEntity();
    unselectedImage.isSelected = false;

    imageView.ids = [
      faker.datatype.uuid(),
      faker.datatype.uuid(),
      faker.datatype.uuid(),
    ];
    imageView.entities[imageView.ids[0]] = selectedImage1;
    imageView.entities[imageView.ids[1]] = selectedImage2;
    imageView.entities[imageView.ids[2]] = unselectedImage;

    const store = mockStoreCreator(state);

    // Act.
    await thunkBulkDownloadSelected()(store.dispatch, store.getState, {});

    // Assert.
    // It should have downloaded the selected items.
    expect(mockDownloadImageZip).toBeCalledTimes(1);
    const downloadList = mockDownloadImageZip.mock.calls[0][0];
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
    const state = fakeState();
    const imageView = state.imageView;
    // Make it look like a bulk download is already running.
    imageView.bulkDownloadState = RequestState.LOADING;

    // Make it look like we still have at least 1 selected image.
    imageView.ids = [faker.datatype.uuid()];
    const selectedImage = fakeImageEntity();
    selectedImage.isSelected = true;
    imageView.entities[imageView.ids[0]] = selectedImage;

    const store = mockStoreCreator(state);

    // Act.
    await thunkBulkDownloadSelected()(store.dispatch, store.getState, {});

    // Assert.
    // It should not have run any downloads.
    expect(mockDownloadImageZip).not.toBeCalled();
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

  it("creates a thunkTextSearch action", () => {
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
    expect(actions).toHaveLength(1);

    const startQueryAction = actions[0];
    expect(startQueryAction.type).toEqual(
      thunkStartNewQuery.typePrefix + "/pending"
    );

    expect(startQueryAction.meta.arg).toEqual({
      query: queries,
      orderings: expect.anything(),
    });
  });

  each([
    ["loaded", true],
    ["not loaded", false],
  ]).it(
    "creates a clearFullSizedImage action when the image is %s",
    (_: string, imageLoaded: boolean) => {
      // Arrange.
      // Set up the state appropriately.
      const imageId = faker.datatype.uuid();
      const state = fakeState();
      state.imageView.ids = [imageId];
      const fakeEntity = fakeImageEntity(undefined, imageLoaded);
      state.imageView.entities[imageId] = fakeEntity;
      const store = mockStoreCreator(state);

      // Act.
      thunkClearFullSizedImage(imageId)(
        store.dispatch,
        store.getState as () => RootState,
        {}
      );

      // Assert.
      if (imageLoaded) {
        // It should have released the loaded image.
        expect(mockRevokeObjectUrl).toBeCalledTimes(1);
        expect(mockRevokeObjectUrl).toBeCalledWith(fakeEntity.imageUrl);
      } else {
        expect(mockRevokeObjectUrl).not.toBeCalled();
      }

      // It should have dispatched the action.
      const actions = store.getActions();
      expect(actions).toHaveLength(1);

      const clearAction = actions[0];
      expect(clearAction.type).toEqual(
        thumbnailGridSlice.actions.clearFullSizedImage.type
      );
      expect(clearAction.payload).toEqual(imageId);
    }
  );

  it("Does nothing when no image is passed to clearFullSizedImage", () => {
    // Arrange.
    const store = mockStoreCreator(fakeState());

    // Act.
    thunkClearFullSizedImage(undefined)(
      store.dispatch,
      store.getState as () => RootState,
      {}
    );

    // Assert.
    // It should have done nothing.
    expect(mockRevokeObjectUrl).not.toBeCalled();
    expect(store.getActions()).toHaveLength(0);
  });
});

describe("thumbnail-grid-slice reducers", () => {
  beforeEach(() => {
    // Set the faker seed.
    faker.seed(1337);
  });

  it("handles an addArtifact action", () => {
    // Arrange.
    const state: ImageViewState = fakeState().imageView;
    const backendId = fakeObjectRef();

    // Act.
    const newState = thumbnailGridSlice.reducer(state, addArtifact(backendId));

    // Assert.
    // It should have added a new entity.
    expect(newState.ids.length).toEqual(1);
    expect(newState.entities[newState.ids[0]]?.backendId).toEqual(backendId);
  });

  it("handles a clearFullSizedImage action", () => {
    // Arrange.
    const state: RootState = fakeState();
    // Make it look like an image is loaded.
    const imageId = faker.datatype.uuid();
    state.imageView.ids = [imageId];
    state.imageView.entities[imageId] = fakeImageEntity(undefined, true);

    // Act.
    const newImageState = thumbnailGridSlice.reducer(
      state.imageView,
      clearFullSizedImage(imageId)
    );

    // Assert.
    const newState = fakeState();
    newState.imageView = newImageState;

    // It should have removed the image.
    const imageEntities = thumbnailGridSelectors.selectAll(newState);
    expect(imageEntities).toHaveLength(1);
    expect(imageEntities[0].imageUrl).toBeNull();
    expect(imageEntities[0].imageStatus).toEqual(ImageStatus.LOADING);
  });

  it("handles a clearImageView action", () => {
    // Arrange.
    const state: RootState = fakeState();
    // Make it look like an image is loaded.
    const imageId = faker.datatype.uuid();
    state.imageView.ids = [imageId];
    state.imageView.entities[imageId] = fakeImageEntity(undefined, true);

    // Make it look like some other parameters are set.
    state.imageView.currentQueryState = RequestState.SUCCEEDED;
    state.imageView.metadataLoadingState = RequestState.SUCCEEDED;

    // Act.
    const newImageState = thumbnailGridSlice.reducer(
      state.imageView,
      clearImageView(null)
    );

    // Assert.
    const newState = fakeState();
    newState.imageView = newImageState;

    // It should have removed all images.
    const imageEntities = thumbnailGridSelectors.selectAll(newState);
    expect(imageEntities).toHaveLength(0);
    // It should have reset state parameters.
    expect(newImageState.currentQueryState).toEqual(RequestState.IDLE);
    expect(newImageState.currentQueryState).toEqual(RequestState.IDLE);
  });

  it("handles a clearAutocomplete action", () => {
    // Arrange.
    const state: RootState = fakeState();
    // Make it look like we have some autocomplete suggestions.
    state.imageView.search.searchString = faker.lorem.words();
    state.imageView.search.autocompleteSuggestions = fakeSuggestions();
    state.imageView.search.queryState = RequestState.SUCCEEDED;

    // Act.
    const newImageState = thumbnailGridSlice.reducer(
      state.imageView,
      clearAutocomplete(null)
    );

    // Assert.
    expect(newImageState.search.searchString).toEqual("");
    expect(newImageState.search.autocompleteSuggestions.menu).toEqual(
      AutocompleteMenu.NONE
    );
    expect(
      newImageState.search.autocompleteSuggestions.textCompletions
    ).toHaveLength(0);
    expect(newImageState.search.queryState).toEqual(RequestState.IDLE);
  });

  it("handles a selectImages action", () => {
    // Arrange.
    const state = fakeState().imageView;
    // Make it look like some images are selected.
    const selectedImage1 = fakeImageEntity();
    selectedImage1.isSelected = true;
    const selectedImage2 = fakeImageEntity();
    selectedImage2.isSelected = true;
    const unselectedImage1 = fakeImageEntity();
    unselectedImage1.isSelected = false;
    const unselectedImage2 = fakeImageEntity();
    unselectedImage2.isSelected = false;

    const selectedImage1Id = createImageEntityId(selectedImage1.backendId);
    const selectedImage2Id = createImageEntityId(selectedImage2.backendId);
    const unselectedImage1Id = createImageEntityId(unselectedImage1.backendId);
    const unselectedImage2Id = createImageEntityId(unselectedImage2.backendId);
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

    // It should have added the image entity.
    const imageEntities = thumbnailGridSelectors.selectAll(newRootState);
    expect(imageEntities).toHaveLength(1);
    expect(imageEntities[0].backendId).toEqual(fakeImage);
    expect(imageEntities[0].thumbnailStatus).toEqual(ImageStatus.LOADING);
    expect(imageEntities[0].thumbnailUrl).toBe(null);
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

    // It should have added the image entity.
    const imageEntities = thumbnailGridSelectors.selectAll(newRootState);
    expect(imageEntities).toHaveLength(1);
    expect(imageEntities[0].backendId).toEqual(fakeImage);
    expect(imageEntities[0].thumbnailStatus).toEqual(ImageStatus.LOADING);
    expect(imageEntities[0].thumbnailUrl).toBe(null);

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

  it("handles a loadThumbnail/fulfilled action", () => {
    // Arrange.
    const state: ImageViewState = fakeState().imageView;

    // Fix up the state so it looks like we already have a loading thumbnail.
    const fakeEntity = fakeImageEntity(false);
    // In this case, the image ID has to be consistent with the backend ID
    // from the generated entity.
    const imageId: string = createImageEntityId(fakeEntity.backendId);
    state.ids = [imageId];
    state.entities[imageId] = fakeEntity;

    // Create fake loaded image data.
    const imageInfo = { imageId: imageId, imageUrl: faker.image.dataUri() };
    // Create the action.
    const action = {
      type: thunkLoadThumbnail.fulfilled.type,
      payload: imageInfo,
    };

    // Act.
    const newState: ImageViewState = thumbnailGridReducer(state, action);

    // Assert.
    // It should have updated the entity for the image.
    const imageEntity = newState.entities[imageId];
    expect(imageEntity?.thumbnailStatus).toEqual(ImageStatus.VISIBLE);
    expect(imageEntity?.thumbnailUrl).toEqual(imageInfo.imageUrl);
  });

  it("handles a loadImage/fulfilled action", () => {
    // Arrange.
    const state: ImageViewState = fakeState().imageView;

    // Fix up the state so it looks like we already have a loading image.
    const fakeEntity = fakeImageEntity(undefined, false);
    // In this case, the image ID has to be consistent with the backend ID
    // from the generated entity.
    const imageId: string = createImageEntityId(fakeEntity.backendId);
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
    expect(imageEntity?.imageStatus).toEqual(ImageStatus.VISIBLE);
    expect(imageEntity?.imageUrl).toEqual(imageInfo.imageUrl);
  });

  it("handles a loadMetadata/pending action", () => {
    // Arrange.
    const state: ImageViewState = fakeState().imageView;
    state.metadataLoadingState = RequestState.IDLE;

    // Act.
    const newState: ImageViewState = thumbnailGridReducer(state, {
      type: thunkLoadMetadata.typePrefix + "/pending",
    });

    // Assert.
    // It should have marked the metadata as loading.
    expect(newState.metadataLoadingState).toEqual(RequestState.LOADING);
  });

  it("handles a loadMetadata/fulfilled action", () => {
    // Arrange.
    const state: ImageViewState = fakeState().imageView;

    // Fix up the state so it looks like we already have a thumbnail.
    const fakeEntity = fakeImageEntity(true);
    // In this case, the image ID has to be consistent with the backend ID
    // from the generated entity.
    const imageId: string = createImageEntityId(fakeEntity.backendId);
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
