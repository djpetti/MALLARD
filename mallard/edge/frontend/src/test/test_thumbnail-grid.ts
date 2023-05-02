import { ConnectedThumbnailGrid } from "../thumbnail-grid";
import {
  fakeImageEntities,
  fakeImageEntity,
  fakeState,
  getShadowRoot,
} from "./element-test-utils";
import { ThumbnailGridSection } from "../thumbnail-grid-section";
import { RequestState, RootState } from "../types";
import each from "jest-each";
import {
  thunkLoadMetadata,
  thunkStartNewQuery,
  thunkContinueQuery,
} from "../thumbnail-grid-slice";
import { faker } from "@faker-js/faker";

jest.mock("../thumbnail-grid-slice", () => {
  const actualSlice = jest.requireActual("../thumbnail-grid-slice");

  return {
    thunkLoadMetadata: jest.fn(),
    thunkStartNewQuery: jest.fn(),
    thunkContinueQuery: jest.fn(),
    createImageEntityId: actualSlice.createImageEntityId,
    thumbnailGridSelectors: {
      selectIds: actualSlice.thumbnailGridSelectors.selectIds,
      selectById: actualSlice.thumbnailGridSelectors.selectById,
    },
  };
});
const mockThunkLoadMetadata = thunkLoadMetadata as jest.MockedFn<
  typeof thunkLoadMetadata
>;
const mockThunkStartNewQuery = thunkStartNewQuery as jest.MockedFn<
  typeof thunkStartNewQuery
>;
const mockThunkContinueQuery = thunkContinueQuery as jest.MockedFn<
  typeof thunkContinueQuery
>;

jest.mock("@captaincodeman/redux-connect-element", () => ({
  // Turn connect() into a pass-through.
  connect: jest.fn((_, elementClass) => elementClass),
}));
jest.mock("../store", () => ({
  // Mock this to avoid an annoying spurious console error from Redux.
  configureStore: jest.fn(),
}));

class TestThumbnailGrid extends ConnectedThumbnailGrid {
  public updateFromState(state: RootState) {
    Object.assign(this, this.mapState(state));
  }
}

describe("thumbnail-grid", () => {
  /** Internal thumbnail-grid to use for testing. */
  let gridElement: TestThumbnailGrid;

  beforeAll(() => {
    // Manually register the custom element.
    customElements.define(TestThumbnailGrid.tagName, TestThumbnailGrid);
  });

  beforeEach(() => {
    // Set a faker seed.
    faker.seed(1337);

    // Reset mocks.
    jest.clearAllMocks();

    gridElement = window.document.createElement(
      TestThumbnailGrid.tagName
    ) as TestThumbnailGrid;
    // Default to not being in loading mode, since that's typically what
    // we want to test.
    gridElement.loadingState = RequestState.IDLE;
    document.body.appendChild(gridElement);
  });

  afterEach(() => {
    document.body.getElementsByTagName(TestThumbnailGrid.tagName)[0].remove();
  });

  each([
    ["with a session name", faker.lorem.words()],
    ["without a session name", undefined],
  ]).it("renders thumbnails correctly %s", async (_, session?: string) => {
    // Arrange.
    // Add some fake artifacts.
    const artifactIds = [faker.datatype.uuid(), faker.datatype.uuid()];
    const captureDate = faker.date.past();
    gridElement.groupedArtifacts = [
      {
        imageIds: artifactIds,
        captureDate: captureDate,
        session: session,
      },
    ];

    // Act.
    // groupedArtifacts isn't actually a reactive property, so we have to
    // update manually.
    gridElement.requestUpdate();
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
    // It should have set the section header.
    expect(gridSection.sectionHeader).toContain(
      captureDate.toISOString().split("T")[0]
    );
    if (session !== undefined) {
      // Date should be in parentheses.
      expect(gridSection.sectionHeader).toContain("(");
      expect(gridSection.sectionHeader).toContain(session);
    } else {
      // It should show just the date.
      expect(gridSection.sectionHeader).not.toContain("(");
    }

    // It should not be showing the "no data" message.
    const emptyMessage = root.querySelector("#empty_message") as HTMLElement;
    expect(emptyMessage.classList).toContain("hidden");
  });

  it("renders a loading indicator when requested", async () => {
    // Arrange.
    // Make it look like we are loading data.
    gridElement.loadingState = RequestState.LOADING;

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
    gridElement.loadingState = RequestState.SUCCEEDED;

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
    // It will automatically set the status to "loading" after the first load event
    // to simulate actual behavior and avoid an infinite loop.
    const loadDataHandler = jest.fn(
      (_) => (gridElement.loadingState = RequestState.LOADING)
    );
    gridElement.addEventListener(
      ConnectedThumbnailGrid.LOAD_MORE_DATA_BOTTOM_EVENT_NAME,
      loadDataHandler
    );

    // Act.
    await gridElement.requestUpdate();
    await gridElement.updateComplete;

    // Assert.
    // It should have tried to load more data.
    expect(loadDataHandler).toBeCalledTimes(1);
  });

  it("clears the thumbnails on top when enough data are loaded", async () => {
    // Arrange.
    // First, make it look like we have too many thumbnails.
    const state = fakeState();
    // Limit the number of images here to limit memory/computation.
    const images = fakeImageEntities(10, true);
    state.imageView.ids = images.ids;
    state.imageView.entities = images.entities;
    // Set this artificially so it triggers the clearing of old data.
    state.imageView.numThumbnailsLoaded =
      ConnectedThumbnailGrid.MAX_THUMBNAILS_LOADED + 1;
    state.imageView.currentQueryHasMorePages = true;

    // Make it look like the user has scrolled down.
    Object.defineProperty(gridElement, "clientHeight", { value: 1000 });
    Object.defineProperty(gridElement, "scrollHeight", { value: 1500 });
    Object.defineProperty(gridElement, "scrollTop", { value: 500 });

    // Set up a fake handler for the data deletion event.
    // It will automatically set the status to "loading" after the first load event
    // to simulate actual behavior and avoid an infinite loop.
    const deleteDataHandler = jest.fn(
      (_) => (gridElement.loadingState = RequestState.LOADING)
    );
    gridElement.addEventListener(
      ConnectedThumbnailGrid.DELETE_DATA_EVENT_NAME,
      deleteDataHandler
    );

    // Act.
    // Set the state correctly.
    while (!(await gridElement.updateComplete)) {}
    gridElement.updateFromState(state);
    while (!(await gridElement.updateComplete)) {}

    // Assert.
    // It should have deleted data once.
    expect(deleteDataHandler).toBeCalledTimes(1);
    // It should have deleted the top page.
    const deleteIds = deleteDataHandler.mock.calls[0][0].detail;
    expect(deleteIds).toEqual(
      gridElement.orderedArtifactIds.slice(
        0,
        ConnectedThumbnailGrid.IMAGES_PER_PAGE
      )
    );
  });

  it("does not load data if it doesn't need to", async () => {
    // Arrange.
    // Make it look like the user has not scrolled down.
    Object.defineProperty(gridElement, "clientHeight", { value: 1000 });
    Object.defineProperty(gridElement, "scrollHeight", { value: 3000 });
    Object.defineProperty(gridElement, "scrollTop", { value: 0 });

    // Set up a fake handler for the loading data event.
    // It will automatically set the status to "loading" after the first load event
    // to simulate actual behavior and avoid an infinite loop.
    const loadDataHandler = jest.fn(
      (_) => (gridElement.loadingState = RequestState.LOADING)
    );
    gridElement.addEventListener(
      ConnectedThumbnailGrid.LOAD_MORE_DATA_BOTTOM_EVENT_NAME,
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
    gridElement.loadingState = RequestState.LOADING;

    // Set up a fake handler for the loading data event.
    // It will automatically set the status to "loading" after the first load event
    // to simulate actual behavior and avoid an infinite loop.
    const loadDataHandler = jest.fn(
      (_) => (gridElement.loadingState = RequestState.LOADING)
    );
    gridElement.addEventListener(
      ConnectedThumbnailGrid.LOAD_MORE_DATA_BOTTOM_EVENT_NAME,
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
    gridElement.loadingState = RequestState.SUCCEEDED;
    gridElement.hasMorePages = false;

    // Set up a fake handler for the loading data event.
    // It will automatically set the status to "loading" after the first load event
    // to simulate actual behavior and avoid an infinite loop.
    const loadDataHandler = jest.fn(
      (_) => (gridElement.loadingState = RequestState.LOADING)
    );
    gridElement.addEventListener(
      ConnectedThumbnailGrid.LOAD_MORE_DATA_BOTTOM_EVENT_NAME,
      loadDataHandler
    );

    // Act.
    await gridElement.requestUpdate();
    await gridElement.updateComplete;

    // Assert.
    // It should not have tried to load more data.
    expect(loadDataHandler).toBeCalledTimes(0);
  });

  each([
    ["idle", RequestState.IDLE, RequestState.IDLE],
    ["loading", RequestState.LOADING, RequestState.LOADING],
    ["loading", RequestState.IDLE, RequestState.LOADING],
    ["loading", RequestState.IDLE, RequestState.SUCCEEDED],
    ["successful", RequestState.SUCCEEDED, RequestState.SUCCEEDED],
  ]).it(
    "updates the properties from the Redux state when requests are %s",
    (_: string, contentState: RequestState, metadataState: RequestState) => {
      // Arrange.
      const imageId = faker.datatype.uuid();

      // Create a fake state.
      const state: RootState = fakeState();
      state.imageView.ids = [imageId];
      state.imageView.entities[imageId] = fakeImageEntity(false, false);
      state.imageView.currentQueryState = contentState;
      state.imageView.metadataLoadingState = metadataState;

      // Act.
      const updates = gridElement.mapState(state);

      // Assert.
      // It should have gotten the correct updates.
      expect(updates).toHaveProperty("displayedArtifacts");
      expect(updates["displayedArtifacts"]).toEqual(state.imageView.ids);
      expect(updates["loadingState"]).toEqual(
        contentState == RequestState.SUCCEEDED &&
          metadataState == RequestState.SUCCEEDED
          ? RequestState.SUCCEEDED
          : contentState == RequestState.IDLE &&
            metadataState == RequestState.IDLE
          ? RequestState.IDLE
          : RequestState.LOADING
      );
      expect(updates["hasMorePages"]).toEqual(
        state.imageView.currentQueryHasMorePages
      );

      // There should be no grouped images, because our input lacks metadata.
      expect(updates).toHaveProperty("groupedArtifacts");
      expect(updates["groupedArtifacts"]).toEqual([]);
    }
  );

  it("marks loading as finished when there are no data", () => {
    // Arrange.
    // Create a fake state.
    const state: RootState = fakeState();
    state.imageView.ids = [];
    // Make it look like the initial query succeeded, but the metadata fetch
    // never ran because the query produced no results.
    state.imageView.currentQueryState = RequestState.SUCCEEDED;
    state.imageView.metadataLoadingState = RequestState.IDLE;

    // Act.
    const updates = gridElement.mapState(state);

    // Assert.
    // It should have gotten the correct updates.
    expect(updates["loadingState"]).toEqual(RequestState.SUCCEEDED);
  });

  it("groups by date correctly when updating from the Redux state", () => {
    // Arrange.
    const imageId1 = faker.datatype.uuid();
    const imageId2 = faker.datatype.uuid();
    const imageId3 = faker.datatype.uuid();
    const imageId4 = faker.datatype.uuid();

    // Create a fake state.
    const state: RootState = fakeState();
    state.imageView.ids = [imageId1, imageId2, imageId3, imageId4];

    // Make it look like the capture date is the same for two of them.
    const captureDate1 = faker.date.past();
    // Make sure one date is a day before the other.
    const captureDate2 = new Date(captureDate1.getTime() - 1000 * 60 * 60 * 24);
    // Make it look like there are two sessions.
    const session1 = "a" + faker.lorem.words();
    const session2 = "b" + faker.lorem.words();

    state.imageView.entities[imageId1] = fakeImageEntity(
      true,
      undefined,
      captureDate1,
      session1
    );
    state.imageView.entities[imageId2] = fakeImageEntity(
      true,
      undefined,
      captureDate1,
      session1
    );
    state.imageView.entities[imageId3] = fakeImageEntity(
      true,
      undefined,
      captureDate2,
      session1
    );
    state.imageView.entities[imageId4] = fakeImageEntity(
      true,
      undefined,
      captureDate2,
      session2
    );

    // Act.
    const updates = gridElement.mapState(state);

    // Assert.
    // It should have gotten the correct updates.
    expect(updates).toHaveProperty("displayedArtifacts");
    expect(updates["displayedArtifacts"]).toEqual(state.imageView.ids);

    // It should have grouped things correctly.
    expect(updates).toHaveProperty("groupedArtifacts");
    const groups = updates["groupedArtifacts"];
    expect(groups).toHaveLength(3);

    // They should be sorted in order by date, descending.
    expect(groups[0].captureDate).toEqual(captureDate1);
    expect(groups[0].imageIds).toEqual([imageId1, imageId2]);

    expect(groups[1].captureDate).toEqual(captureDate2);
    expect(groups[1].imageIds).toEqual([imageId3]);

    expect(groups[2].captureDate).toEqual(captureDate2);
    expect(groups[2].imageIds).toEqual([imageId4]);
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

  each([
    ["no query is running", false],
    ["a query is running", true],
  ]).it(
    "maps the correct actions to the load-more-data event when %s",
    (_: string, isQueryRunning: boolean) => {
      // Arrange.
      gridElement.isQueryRunning = isQueryRunning;
      gridElement.queryPageNum = faker.datatype.number();

      // Act.
      const eventMap = gridElement.mapEvents();

      // Assert.
      // It should have a mapping for the proper events.
      expect(eventMap).toHaveProperty(
        ConnectedThumbnailGrid.LOAD_MORE_DATA_BOTTOM_EVENT_NAME
      );

      // This should fire the appropriate action creator.
      const testEvent = { detail: [faker.datatype.number()] };
      eventMap[ConnectedThumbnailGrid.LOAD_MORE_DATA_BOTTOM_EVENT_NAME](
        testEvent as unknown as Event
      );

      if (!isQueryRunning) {
        // Starting a new query
        expect(mockThunkStartNewQuery).toBeCalledTimes(1);
        expect(mockThunkStartNewQuery).toBeCalledWith({
          query: expect.any(Object),
          resultsPerPage: expect.any(Number),
        });

        expect(mockThunkContinueQuery).not.toBeCalled();
      } else {
        // Continuing an old one
        expect(mockThunkContinueQuery).toBeCalledTimes(1);
        expect(mockThunkContinueQuery).toBeCalledWith(
          gridElement.queryPageNum + 1
        );

        expect(mockThunkStartNewQuery).not.toBeCalled();
      }
    }
  );
});
