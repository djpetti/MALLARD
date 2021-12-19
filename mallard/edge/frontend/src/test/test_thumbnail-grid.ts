import { ConnectedThumbnailGrid } from "../thumbnail-grid";
import {
  fakeState,
  fakeThumbnailEntity,
  getShadowRoot,
} from "./element-test-utils";
import { ThumbnailGridSection } from "../thumbnail-grid-section";
import { RequestState, RootState } from "../types";

const faker = require("faker");

// Using older require syntax here so we get the correct mock type.
const thumbnailGridSlice = require("../thumbnail-grid-slice");
const mockThunkLoadMetadata = thumbnailGridSlice.thunkLoadMetadata;
const mockThunkQuery = thumbnailGridSlice.thunkStartQuery;
const mockThumbnailGridSelectors = thumbnailGridSlice.thumbnailGridSelectors;
const { thumbnailGridSelectors } = jest.requireActual(
  "../thumbnail-grid-slice"
);

jest.mock("@captaincodeman/redux-connect-element", () => ({
  // Turn connect() into a pass-through.
  connect: jest.fn((_, elementClass) => elementClass),
}));
jest.mock("../thumbnail-grid-slice", () => ({
  thunkLoadMetadata: jest.fn(),
  thunkStartQuery: jest.fn(),
  thumbnailGridSelectors: { selectIds: jest.fn(), selectById: jest.fn() },
}));
jest.mock("../store", () => ({
  // Mock this to avoid an annoying spurious console error from Redux.
  configureStore: jest.fn(),
}));

describe("thumbnail-grid", () => {
  /** Internal thumbnail-grid to use for testing. */
  let gridElement: ConnectedThumbnailGrid;

  beforeAll(() => {
    // Manually register the custom element.
    customElements.define(
      ConnectedThumbnailGrid.tagName,
      ConnectedThumbnailGrid
    );
  });

  beforeEach(() => {
    // Set a faker seed.
    faker.seed(1337);

    // Use the actual implementation for these functions.
    mockThumbnailGridSelectors.selectIds.mockImplementation(
      thumbnailGridSelectors.selectIds
    );
    mockThumbnailGridSelectors.selectById.mockImplementation(
      thumbnailGridSelectors.selectById
    );

    gridElement = window.document.createElement(
      ConnectedThumbnailGrid.tagName
    ) as ConnectedThumbnailGrid;
    // Default to not being in loading mode, since that's typically what
    // we want to test.
    gridElement.isLoading = false;
    document.body.appendChild(gridElement);
  });

  afterEach(() => {
    document.body
      .getElementsByTagName(ConnectedThumbnailGrid.tagName)[0]
      .remove();
  });

  it("renders thumbnails correctly", async () => {
    // Arrange.
    // Add some fake artifacts.
    const artifactIds = [faker.datatype.uuid(), faker.datatype.uuid()];
    gridElement.groupedArtifacts = [
      {
        imageIds: artifactIds,
        captureDate: faker.date.past(),
      },
    ];

    // Act.
    await gridElement.updateComplete;

    // Assert.
    // It should have rendered the thumbnail.
    const root = getShadowRoot(ConnectedThumbnailGrid.tagName);
    const gridDiv = root.querySelector(".thumbnail_grid") as HTMLElement;
    expect(gridDiv).not.toBe(null);
    expect(gridDiv.childElementCount).toEqual(1);

    // It should have set the correct thumbnails.
    const gridSection = gridDiv.children[0] as ThumbnailGridSection;
    expect(gridSection.displayedArtifacts).toEqual(artifactIds);

    // It should not be showing the "no data" message.
    const emptyMessage = root.querySelector("#empty_message") as HTMLElement;
    expect(emptyMessage.classList).toContain("hidden");
  });

  it("renders a loading indicator when requested", async () => {
    // Arrange.
    // Make it look like we are loading data.
    gridElement.queryComplete = false;

    // Act.
    await gridElement.updateComplete;

    // Assert.
    // It should have rendered the loading indicator.
    const root = getShadowRoot(ConnectedThumbnailGrid.tagName);
    const loadingIndicator = root.querySelector(
      "#loading_indicator"
    ) as HTMLElement;
    expect(loadingIndicator.classList).not.toContain("hidden");
  });

  it("renders a message when there are no data", async () => {
    // Arrange.
    // Make it look like there are no artifacts, but it is finished loading.
    gridElement.groupedArtifacts = [];
    gridElement.queryComplete = true;

    // Act.
    await gridElement.updateComplete;

    // Assert.
    // It should have rendered a message.
    const root = getShadowRoot(ConnectedThumbnailGrid.tagName);
    const emptyMessage = root.querySelector("#empty_message") as HTMLElement;
    expect(emptyMessage.classList).not.toContain("hidden");
  });

  it("loads more data when the user scrolls", async () => {
    // Arrange.
    // Make it look like the user has scrolled down.
    Object.defineProperty(gridElement, "clientHeight", { value: 1000 });
    Object.defineProperty(gridElement, "scrollHeight", { value: 1500 });
    Object.defineProperty(gridElement, "scrollTop", { value: 500 });

    // Set up a fake handler for the loading data event.
    // It will automatically set isLoading to true after the first load event
    // to simulate actual behavior and avoid an infinite loop.
    const loadDataHandler = jest.fn((_) => (gridElement.isLoading = true));
    gridElement.addEventListener(
      ConnectedThumbnailGrid.LOAD_MORE_DATA_EVENT_NAME,
      loadDataHandler
    );

    // Act.
    await gridElement.requestUpdate();
    await gridElement.updateComplete;

    // Assert.
    // It should have tried to load more data.
    expect(loadDataHandler).toBeCalledTimes(1);
    // It should initially query the first page.
    expect(loadDataHandler.mock.calls[0][0].detail).toEqual(1);
  });

  it("does not load data if it doesn't need to", async () => {
    // Arrange.
    // Make it look like the user has not scrolled down.
    Object.defineProperty(gridElement, "clientHeight", { value: 1000 });
    Object.defineProperty(gridElement, "scrollHeight", { value: 3000 });
    Object.defineProperty(gridElement, "scrollTop", { value: 0 });

    // Set up a fake handler for the loading data event.
    // It will automatically set isLoading to true after the first load event
    // to simulate actual behavior and avoid an infinite loop.
    const loadDataHandler = jest.fn((_) => (gridElement.isLoading = true));
    gridElement.addEventListener(
      ConnectedThumbnailGrid.LOAD_MORE_DATA_EVENT_NAME,
      loadDataHandler
    );

    // Act.
    await gridElement.requestUpdate();
    await gridElement.updateComplete;

    // Assert.
    // It should not have tried to load more data.
    expect(loadDataHandler).toBeCalledTimes(0);
  });

  it("does not load data if it's already loading", async () => {
    // Arrange.
    // Make it look like the user has scrolled down.
    Object.defineProperty(gridElement, "clientHeight", { value: 1000 });
    Object.defineProperty(gridElement, "scrollHeight", { value: 1500 });
    Object.defineProperty(gridElement, "scrollTop", { value: 500 });

    // Make it look like it's loading.
    gridElement.isLoading = true;

    // Set up a fake handler for the loading data event.
    // It will automatically set isLoading to true after the first load event
    // to simulate actual behavior and avoid an infinite loop.
    const loadDataHandler = jest.fn((_) => (gridElement.isLoading = true));
    gridElement.addEventListener(
      ConnectedThumbnailGrid.LOAD_MORE_DATA_EVENT_NAME,
      loadDataHandler
    );

    // Act.
    await gridElement.requestUpdate();
    await gridElement.updateComplete;

    // Assert.
    // It should not have tried to load more data.
    expect(loadDataHandler).toBeCalledTimes(0);
  });

  it("stops loading when there are no more data", async () => {
    // Arrange.
    // Make it look like the user has scrolled down.
    Object.defineProperty(gridElement, "clientHeight", { value: 1000 });
    Object.defineProperty(gridElement, "scrollHeight", { value: 1500 });
    Object.defineProperty(gridElement, "scrollTop", { value: 500 });

    // Make it look like we have no more data to load.
    gridElement.isLoading = false;
    gridElement.hasMorePages = false;

    // Set up a fake handler for the loading data event.
    // It will automatically set isLoading to true after the first load event
    // to simulate actual behavior and avoid an infinite loop.
    const loadDataHandler = jest.fn((_) => (gridElement.isLoading = true));
    gridElement.addEventListener(
      ConnectedThumbnailGrid.LOAD_MORE_DATA_EVENT_NAME,
      loadDataHandler
    );

    // Act.
    await gridElement.requestUpdate();
    await gridElement.updateComplete;

    // Assert.
    // It should not have tried to load more data.
    expect(loadDataHandler).toBeCalledTimes(0);
  });

  it("updates the properties from the Redux state", () => {
    // Arrange.
    const imageId = faker.datatype.uuid();

    // Create a fake state.
    const state: RootState = fakeState();
    state.thumbnailGrid.ids = [imageId];
    state.thumbnailGrid.entities[imageId] = fakeThumbnailEntity(false);
    const possibleStates = [RequestState.LOADING, RequestState.SUCCEEDED];
    state.thumbnailGrid.currentQueryState =
      faker.random.arrayElement(possibleStates);
    state.thumbnailGrid.currentQueryState =
      faker.random.arrayElement(possibleStates);

    // Act.
    const updates = gridElement.mapState(state);

    // Assert.
    // It should have gotten the correct updates.
    expect(updates).toHaveProperty("displayedArtifacts");
    expect(updates["displayedArtifacts"]).toEqual(state.thumbnailGrid.ids);
    expect(updates["isLoading"]).toEqual(
      state.thumbnailGrid.currentQueryState == RequestState.LOADING ||
        state.thumbnailGrid.metadataLoadingState == RequestState.LOADING
    );
    expect(updates["queryComplete"]).toEqual(
      state.thumbnailGrid.currentQueryState == RequestState.SUCCEEDED &&
        state.thumbnailGrid.metadataLoadingState == RequestState.SUCCEEDED
    );
    expect(updates["hasMorePages"]).toEqual(
      state.thumbnailGrid.lastQueryHasMorePages
    );

    // There should be no grouped images, because our input lacks metadata.
    expect(updates).toHaveProperty("groupedArtifacts");
    expect(updates["groupedArtifacts"]).toEqual([]);
  });

  it("groups by date correctly when updating from the Redux state", () => {
    // Arrange.
    const imageId1 = faker.datatype.uuid();
    const imageId2 = faker.datatype.uuid();
    const imageId3 = faker.datatype.uuid();

    // Create a fake state.
    const state: RootState = fakeState();
    state.thumbnailGrid.ids = [imageId1, imageId2, imageId3];

    // Make it look like the capture date is the same for two of them.
    const captureDate1 = faker.date.past();
    // Make sure one date is a day before the other.
    const captureDate2 = new Date(captureDate1.getTime() - 1000 * 60 * 60 * 24);
    state.thumbnailGrid.entities[imageId1] = fakeThumbnailEntity(
      true,
      captureDate1
    );
    state.thumbnailGrid.entities[imageId2] = fakeThumbnailEntity(
      true,
      captureDate1
    );
    state.thumbnailGrid.entities[imageId3] = fakeThumbnailEntity(
      true,
      captureDate2
    );

    // Act.
    const updates = gridElement.mapState(state);

    // Assert.
    // It should have gotten the correct updates.
    expect(updates).toHaveProperty("displayedArtifacts");
    expect(updates["displayedArtifacts"]).toEqual(state.thumbnailGrid.ids);

    // It should have grouped things correctly.
    expect(updates).toHaveProperty("groupedArtifacts");
    const groups = updates["groupedArtifacts"];
    expect(groups).toHaveLength(2);

    // They should be sorted in order by date, descending.
    expect(groups[1].captureDate).toEqual(captureDate2);
    expect(groups[1].imageIds).toEqual([imageId3]);

    expect(groups[0].captureDate).toEqual(captureDate1);
    expect(groups[0].imageIds).toEqual([imageId1, imageId2]);
  });

  it("maps the correct actions to the images-changed event", () => {
    // Act.
    const eventMap = gridElement.mapEvents();

    // Assert.
    // It should have a mapping for the proper events.
    expect(eventMap).toHaveProperty(
      ConnectedThumbnailGrid.IMAGES_CHANGED_EVENT_NAME
    );

    // This should fire the appropriate action creator.
    const testEvent = { detail: [faker.datatype.uuid()] };
    eventMap[ConnectedThumbnailGrid.IMAGES_CHANGED_EVENT_NAME](
      testEvent as unknown as Event
    );

    expect(mockThunkLoadMetadata).toBeCalledTimes(1);
    expect(mockThunkLoadMetadata).toBeCalledWith(testEvent.detail);
  });

  it("maps the correct actions to the load-more-data event", () => {
    // Act.
    const eventMap = gridElement.mapEvents();

    // Assert.
    // It should have a mapping for the proper events.
    expect(eventMap).toHaveProperty(
      ConnectedThumbnailGrid.LOAD_MORE_DATA_EVENT_NAME
    );

    // This should fire the appropriate action creator.
    const testEvent = { detail: [faker.datatype.number()] };
    eventMap[ConnectedThumbnailGrid.LOAD_MORE_DATA_EVENT_NAME](
      testEvent as unknown as Event
    );

    expect(mockThunkQuery).toBeCalledTimes(1);
    expect(mockThunkQuery).toBeCalledWith({
      query: expect.any(Object),
      orderings: expect.any(Array),
      resultsPerPage: expect.any(Number),
      pageNum: testEvent.detail,
    });
  });
});
