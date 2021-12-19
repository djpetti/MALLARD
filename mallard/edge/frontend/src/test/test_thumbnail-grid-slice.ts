import configureStore, { MockStoreCreator } from "redux-mock-store";
import thumbnailGridReducer, {
  thumbnailGridSelectors,
  thunkLoadMetadata,
  thunkLoadThumbnail,
  thunkStartQuery,
} from "../thumbnail-grid-slice";
import {
  ImageQuery,
  RequestState,
  ThumbnailGridState,
  ThumbnailStatus,
} from "../types";
import thunk from "redux-thunk";
import { fakeState, fakeThumbnailEntity } from "./element-test-utils";
import each from "jest-each";
import { ObjectRef, QueryResponse, UavImageMetadata } from "typescript-axios";

// Require syntax must be used here due to an issue that prevents
// access to faker.seed() when using import syntax.
const faker = require("faker");

// Using older require syntax here so we get the correct mock type.
const apiClient = require("../api-client");
const queryImages: jest.Mock = apiClient.queryImages;
const loadThumbnail: jest.Mock = apiClient.loadThumbnail;
const getMetadata: jest.Mock = apiClient.getMetadata;

// Mock out the gateway API.
jest.mock("../api-client", () => ({
  queryImages: jest.fn(),
  loadThumbnail: jest.fn(),
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
    state.thumbnailGrid.ids = [imageId];
    state.thumbnailGrid.entities[imageId] = fakeThumbnailEntity(false);
    const store = mockStoreCreator(state);

    // Act.
    await thunkLoadThumbnail(imageId)(store.dispatch, store.getState, {});

    // Assert.
    // It should have dispatched the lifecycle actions.
    const actions = store.getActions();
    expect(actions).toHaveLength(2);

    const pendingAction = actions[0];
    expect(pendingAction.type).toEqual("thumbnailGrid/loadThumbnail/pending");

    const fulfilledAction = actions[1];
    expect(fulfilledAction.type).toEqual(
      "thumbnailGrid/loadThumbnail/fulfilled"
    );
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
    state.thumbnailGrid.ids = [imageId];
    state.thumbnailGrid.entities[imageId] = fakeThumbnailEntity(false);
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

  it("handles a startQuery/pending action", () => {
    // Arrange.
    const state: ThumbnailGridState = fakeState().thumbnailGrid;
    state.currentQueryState = RequestState.IDLE;

    // Act.
    const newState: ThumbnailGridState = thumbnailGridReducer(state, {
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
      const state: ThumbnailGridState = fakeState().thumbnailGrid;

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
      const newState: ThumbnailGridState = thumbnailGridReducer(state, action);

      // Assert.
      // It should have marked the query as succeeded.
      expect(newState.currentQueryState).toEqual(RequestState.SUCCEEDED);

      // We need the full state to use selectors.
      const newRootState = fakeState();
      newRootState.thumbnailGrid = newState;

      // It should have added the image entity.
      const imageEntities = thumbnailGridSelectors.selectAll(newRootState);
      expect(imageEntities).toHaveLength(1);
      expect(imageEntities[0].backendId).toEqual(fakeImage);
      expect(imageEntities[0].status).toEqual(ThumbnailStatus.LOADING);
      expect(imageEntities[0].imageUrl).toBe(null);

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
    const state: ThumbnailGridState = fakeState().thumbnailGrid;

    // Fix up the state so it looks like we already have a loading thumbnail.
    const fakeEntity = fakeThumbnailEntity(false);
    // In this case, the image ID has to be consistent with the backend ID
    // from the generated entity.
    const imageId: string = `${fakeEntity.backendId.bucket}/${fakeEntity.backendId.name}`;
    state.ids = [imageId];
    state.entities[imageId] = fakeEntity;

    // Create fake loaded image data.
    const imageInfo = { imageId: imageId, imageUrl: faker.image.dataUri() };
    // Create the action.
    const action = {
      type: thunkLoadThumbnail.typePrefix + "/fulfilled",
      payload: imageInfo,
    };

    // Act.
    const newState: ThumbnailGridState = thumbnailGridReducer(state, action);

    // Assert.
    // It should have updated the entity for the image.
    const imageEntity = newState.entities[imageId];
    expect(imageEntity?.status).toEqual(ThumbnailStatus.VISIBLE);
    expect(imageEntity?.imageUrl).toEqual(imageInfo.imageUrl);
  });

  it("handles a loadMetadata/pending action", () => {
    // Arrange.
    const state: ThumbnailGridState = fakeState().thumbnailGrid;
    state.metadataLoadingState = RequestState.IDLE;

    // Act.
    const newState: ThumbnailGridState = thumbnailGridReducer(state, {
      type: thunkLoadMetadata.typePrefix + "/pending",
    });

    // Assert.
    // It should have marked the metadata as loading.
    expect(newState.metadataLoadingState).toEqual(RequestState.LOADING);
  });

  it("handles a loadMetadata/fulfilled action", () => {
    // Arrange.
    const state: ThumbnailGridState = fakeState().thumbnailGrid;

    // Fix up the state so it looks like we already have a thumbnail.
    const fakeEntity = fakeThumbnailEntity(true);
    // In this case, the image ID has to be consistent with the backend ID
    // from the generated entity.
    const imageId: string = `${fakeEntity.backendId.bucket}/${fakeEntity.backendId.name}`;
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
    const newState: ThumbnailGridState = thumbnailGridReducer(state, action);

    // Assert.
    // It should have updated the entity for the image.
    const imageEntity = newState.entities[imageId];
    expect(imageEntity?.metadata).toEqual(metadata);

    // It should have marked the metadata as loaded.
    expect(newState.metadataLoadingState).toEqual(RequestState.SUCCEEDED);
  });
});
