import configureStore, { MockStoreCreator } from "redux-mock-store";
import thumbnailGridReducer, {
  addArtifact,
  createImageEntityId,
  thumbnailGridSelectors,
  thumbnailGridSlice,
  thunkLoadImage,
  thunkLoadMetadata,
  thunkLoadThumbnail,
  thunkStartQuery,
} from "../thumbnail-grid-slice";
import {
  ImageQuery,
  RequestState,
  ImageViewState,
  ImageStatus,
} from "../types";
import thunk from "redux-thunk";
import {
  fakeState,
  fakeImageEntity,
  fakeObjectRef,
} from "./element-test-utils";
import each from "jest-each";
import { ObjectRef, QueryResponse, UavImageMetadata } from "typescript-axios";

// Require syntax must be used here due to an issue that prevents
// access to faker.seed() when using import syntax.
const faker = require("faker");

// Using older require syntax here so we get the correct mock type.
const apiClient = require("../api-client");
const queryImages: jest.Mock = apiClient.queryImages;
const loadThumbnail: jest.Mock = apiClient.loadThumbnail;
const loadImage: jest.Mock = apiClient.loadImage;
const getMetadata: jest.Mock = apiClient.getMetadata;

// Mock out the gateway API.
jest.mock("../api-client", () => ({
  queryImages: jest.fn(),
  loadThumbnail: jest.fn(),
  loadImage: jest.fn(),
  getMetadata: jest.fn(),
}));

// Mock out `createObjectURL`.
const mockCreateObjectUrl = jest.fn();
global.URL.createObjectURL = mockCreateObjectUrl;

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
  });

  it("creates a startQuery action", async () => {
    // Arrange.
    // Make it look like the query request succeeds.
    const queryResult: QueryResponse = {
      imageIds: [],
      pageNum: 1,
      isLastPage: true,
    };
    queryImages.mockResolvedValue(queryResult);

    const store = mockStoreCreator({});
    // Fake query to perform.
    const query: ImageQuery = {};

    // Act.
    await thunkStartQuery({ query: query })(store.dispatch, store.getState, {});

    // Assert.
    // It should have dispatched the lifecycle actions.
    const actions = store.getActions();
    expect(actions).toHaveLength(2);

    const pendingAction = actions[0];
    expect(pendingAction.type).toEqual("thumbnailGrid/startQuery/pending");

    const fulfilledAction = actions[1];
    expect(fulfilledAction.type).toEqual("thumbnailGrid/startQuery/fulfilled");
    expect(fulfilledAction.payload.query).toEqual(query);
    expect(fulfilledAction.payload.result).toEqual(queryResult);
  });

  it("creates a loadThumbnail action", async () => {
    // Arrange.
    // Make it look like the loadThumbnail request succeeds.
    const rawImage = faker.image.cats(128, 128);
    loadThumbnail.mockResolvedValue(rawImage);

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

  it("creates a loadImage action", async () => {
    // Arrange.
    // Make it look like the loadImage request succeeds.
    const rawImage = faker.image.cats(1920, 1080);
    loadImage.mockResolvedValue(rawImage);

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
    await thunkLoadImage(imageId)(store.dispatch, store.getState, {});

    // Assert.
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

  it("creates a loadMetadata action", async () => {
    // Arrange.
    // Make it look like the getMetadata request succeeds.
    const metadata: UavImageMetadata = {
      captureDate: faker.date.past().toISOString(),
    };
    getMetadata.mockResolvedValue(metadata);

    // Initialize the fake store with valid state.
    const imageId: string = faker.datatype.uuid();
    const state = fakeState();
    state.imageView.ids = [imageId];
    state.imageView.entities[imageId] = fakeImageEntity(false);
    const store = mockStoreCreator(state);

    // Act.
    await thunkLoadMetadata([imageId])(store.dispatch, store.getState, {});

    // Assert.
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

  it("handles a startQuery/pending action", () => {
    // Arrange.
    const state: ImageViewState = fakeState().imageView;
    state.currentQueryState = RequestState.IDLE;

    // Act.
    const newState: ImageViewState = thumbnailGridReducer(state, {
      type: thunkStartQuery.typePrefix + "/pending",
    });

    // Assert.
    // It should have marked the query request as loading.
    expect(newState.currentQueryState).toEqual(RequestState.LOADING);
  });

  each([
    ["last page", true],
    ["not last page", false],
  ]).it(
    "handles a startQuery/fulfilled action (%s)",
    (_: string, isLastPage: boolean) => {
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
        type: thunkStartQuery.typePrefix + "/fulfilled",
        payload: {
          result: { imageIds: [fakeImage], pageNum: 1, isLastPage: isLastPage },
          query: query,
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

      if (isLastPage) {
        // The currentQuery value in the state should have been reset.
        expect(newState.currentQuery).toBe(null);
      } else {
        // The currentQuery value should have been preserved so we can re-run the query.
        expect(newState.currentQuery).toEqual(query);
      }
    }
  );

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
