import { ConnectedThumbnailGrid, GroupedImages } from "../thumbnail-grid";
import {
  EntitiesAndIds,
  fakeArtifactEntities,
  fakeArtifactEntity,
  fakeImageWithStatus,
  fakeState,
  getShadowRoot,
} from "./element-test-utils";
import { ThumbnailGridSection } from "../thumbnail-grid-section";
import { RequestState, RootState } from "../types";
import each from "jest-each";
import {
  setScrollLocation,
  thunkContinueQuery,
  thunkSelectImages,
  thunkStartNewQuery,
} from "../thumbnail-grid-slice";
import { faker } from "@faker-js/faker";
import lodash from "lodash";
import MockedClass = jest.MockedClass;
import { ArtifactThumbnail } from "../artifact-thumbnail";

jest.mock("../thumbnail-grid-slice", () => {
  const actualSlice = jest.requireActual("../thumbnail-grid-slice");

  return {
    thunkStartNewQuery: jest.fn(),
    thunkContinueQuery: jest.fn(),
    thunkSelectImages: jest.fn(),
    setScrollLocation: jest.fn(),
    createArtifactEntityId: actualSlice.createArtifactEntityId,
    thumbnailGridSelectors: {
      selectIds: actualSlice.thumbnailGridSelectors.selectIds,
      selectById: actualSlice.thumbnailGridSelectors.selectById,
    },
  };
});
const mockThunkStartNewQuery = thunkStartNewQuery as jest.MockedFn<
  typeof thunkStartNewQuery
>;
const mockThunkContinueQuery = thunkContinueQuery as jest.MockedFn<
  typeof thunkContinueQuery
>;
const mockSetScrollLocation = setScrollLocation as jest.MockedFn<
  typeof setScrollLocation
>;
const mockThunkSelectImages = thunkSelectImages as jest.MockedFn<
  typeof thunkSelectImages
>;

jest.mock("@captaincodeman/redux-connect-element", () => ({
  // Turn connect() into a pass-through.
  connect: jest.fn((_, elementClass) => elementClass),
}));
jest.mock("../store", () => ({
  // Mock this to avoid an annoying spurious console error from Redux.
  configureStore: jest.fn(),
}));

// Mock the ResizeObserver class, because JSDom doesn't implement it.
const mockResizeObserver: MockedClass<any> = jest.fn(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));
global.ResizeObserver = mockResizeObserver;

/**
 * Mocked version of the ThumbnailGridSection class that we use for testing.
 */
class MockThumbnailGridSection extends HTMLElement {
  expanded: boolean = true;

  clearThumbnails = jest.fn();
  reloadThumbnails = jest.fn();

  disableVisibilityTracking = jest.fn();
  enableVisibilityTracking = jest.fn();
}

describe("thumbnail-grid", () => {
  /** Internal thumbnail-grid to use for testing. */
  let gridElement: ConnectedThumbnailGrid;

  /**
   * Creates a fake set of grouped images.
   * @return {GroupedImages[]} The grouped images.
   */
  function fakeGroupedImages(): GroupedImages[] {
    const numImageGroups = faker.datatype.number({ min: 1, max: 10 });
    const groups: GroupedImages[] = [];
    for (let i = 0; i < numImageGroups; ++i) {
      const numImages = faker.datatype.number({ min: 1, max: 25 });
      const imageIds: string[] = [];
      for (let j = 0; j < numImages; ++j) {
        imageIds.push(faker.datatype.uuid());
      }

      groups.push({
        imageIds: imageIds,
        session: faker.lorem.words(),
        captureDate: faker.date.past(),
      });
    }

    return groups;
  }

  beforeAll(() => {
    // Manually register the custom element.
    customElements.define(
      ConnectedThumbnailGrid.tagName,
      ConnectedThumbnailGrid
    );
    // Register the mocked version of the ThumbnailGridSection class.
    customElements.define(
      ThumbnailGridSection.tagName,
      MockThumbnailGridSection
    );
  });

  beforeEach(() => {
    // Set a faker seed.
    faker.seed(1337);

    // Reset mocks.
    jest.clearAllMocks();

    gridElement = window.document.createElement(
      ConnectedThumbnailGrid.tagName
    ) as ConnectedThumbnailGrid;
    // Default to not being in loading mode, since that's typically what
    // we want to test.
    gridElement.loadingState = RequestState.IDLE;
    document.body.appendChild(gridElement);
  });

  afterEach(() => {
    document.body
      .getElementsByTagName(ConnectedThumbnailGrid.tagName)[0]
      .remove();
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

  each([
    ["request active", RequestState.LOADING, false],
    ["request inactive", RequestState.SUCCEEDED, true],
  ]).it(
    "renders a loading indicator when requested (%s)",
    async (_: string, requestState: RequestState, hasMorePages: boolean) => {
      // Arrange.
      // Make it look like we are loading data.
      gridElement.loadingState = requestState;
      gridElement.hasMorePages = hasMorePages;

      // Act.
      await gridElement.updateComplete;

      // Assert.
      // It should have rendered the loading indicator.
      const root = getShadowRoot(ConnectedThumbnailGrid.tagName);
      const loadingIndicator = root.querySelector(
        "#loading_indicator"
      ) as HTMLElement;
      expect(loadingIndicator.classList).not.toContain("hidden");
    }
  );

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

  describe("scroll position restore", () => {
    it("does not restore the position when it has not been saved", async () => {
      // Arrange.
      // Set the initial scroll position.
      const initialScrollPos = faker.datatype.number();
      gridElement.scrollTop = initialScrollPos;

      // Act.
      await gridElement.updateComplete;

      // Assert.
      // It should not have changed anything.
      expect(gridElement.scrollTop).toEqual(initialScrollPos);
    });

    each([
      ["no content", 0],
      ["content", 1000],
    ]).it(
      "handles scroll position restoration when it has %s",
      async (_, contentHeight: number) => {
        // Arrange.
        gridElement.scrollTop = 0;
        // Fake the initial content height.
        Object.defineProperty(gridElement, "scrollHeight", {
          value: contentHeight,
        });

        // Make it look like we have a saved scroll height.
        const savedScrollHeight = faker.datatype.number({
          max: 1000,
        });
        gridElement.savedScrollHeight = savedScrollHeight;

        // Act.
        // Change a property to trigger an update.
        gridElement.hasMorePages = !gridElement.hasMorePages;
        await gridElement.updateComplete;

        // Assert.
        if (savedScrollHeight <= contentHeight) {
          // It should have restored the scroll position.
          expect(gridElement.scrollTop).toEqual(savedScrollHeight);
        } else {
          // No content was loaded yet, so it should have done nothing.
          expect(gridElement.scrollTop).toEqual(0);
        }

        // If we trigger another update, it should not restore it twice.
        gridElement.scrollTop = 0;
        gridElement.hasMorePages = !gridElement.hasMorePages;
        await gridElement.updateComplete;

        expect(gridElement.scrollTop).toEqual(0);
      }
    );
  });

  describe("infinite scrolling", () => {
    /**
     * Fake handler for the event to load more data.
     */
    let loadMoreDataHandler: jest.Mock;

    /**
     * Gets all the displayed sections in the grid element.
     * @return {HTMLCollection} The displayed section elements.
     */
    function getAllSections(): HTMLCollection {
      const root = getShadowRoot(ConnectedThumbnailGrid.tagName);
      const sectionContainer = root.querySelector(
        "#grid_content"
      ) as HTMLDivElement;
      return sectionContainer.children;
    }

    /**
     * Gets the section element at a particular index.
     * @param {number} index The index to get the element at.
     * @return {ThumbnailGridSection} The specified section.
     */
    function getSectionElement(index: number): MockThumbnailGridSection {
      return getAllSections()[index] as MockThumbnailGridSection;
    }

    beforeEach(() => {
      // Set window properties for scrolling.
      Object.defineProperty(gridElement, "clientHeight", { value: 1000 });
      const shadowRoot = getShadowRoot(ConnectedThumbnailGrid.tagName);
      const contentElement = shadowRoot.querySelector(
        "#grid_content"
      ) as HTMLDivElement;
      Object.defineProperty(contentElement, "scrollHeight", { value: 1500 });

      // Set up a fake handler for the loading data event.
      // It will automatically set the status to "loading" after the first load event
      // to simulate actual behavior and avoid an infinite loop.
      loadMoreDataHandler = jest.fn(
        (_) => (gridElement.loadingState = RequestState.LOADING)
      );
      gridElement.addEventListener(
        ConnectedThumbnailGrid.LOAD_MORE_DATA_BOTTOM_EVENT_NAME,
        loadMoreDataHandler
      );
    });

    it("loads more data when the user scrolls", async () => {
      // Arrange.
      // Make it look like the user has scrolled down.
      Object.defineProperty(gridElement, "scrollTop", { value: 500 });

      // Act.
      // We're going to have to manually simulate a scroll event.
      gridElement.dispatchEvent(new Event("scroll"));

      // Assert.
      // It should have tried to load more data.
      expect(loadMoreDataHandler).toBeCalledTimes(1);
    });

    it("loads more data when it needs to, even if a section is collapsed", async () => {
      // Arrange.
      // Simulate a loading status initially.
      gridElement.loadingState = RequestState.LOADING;
      await gridElement.updateComplete;

      // Display some thumbnails.
      const groupedImages = fakeGroupedImages();
      gridElement.groupedArtifacts = groupedImages;
      await gridElement.updateComplete;

      // Initially mark all sections as expanded.
      const root = getShadowRoot(ConnectedThumbnailGrid.tagName);
      const sectionContainer = root.querySelector(
        "#grid_content"
      ) as HTMLDivElement;
      for (const section of sectionContainer.children) {
        (section as ThumbnailGridSection).expanded = true;
      }

      // Simulate a section being collapsed.
      const firstSection = getSectionElement(0);
      firstSection.expanded = false;

      // Make it look like the initial loading has finished.
      gridElement.loadingState = RequestState.SUCCEEDED;
      await gridElement.updateComplete;

      // Make it look like it's loading again.
      gridElement.loadingState = RequestState.LOADING;
      await gridElement.updateComplete;

      // Make it look like the user has scrolled down.
      Object.defineProperty(gridElement, "scrollTop", { value: 500 });

      // Simulate some additional data being loaded into the collapsed section.
      const newlyLoadedImageIds = [
        faker.datatype.uuid(),
        faker.datatype.uuid(),
      ];
      gridElement.groupedArtifacts[0].imageIds =
        groupedImages[0].imageIds.concat(newlyLoadedImageIds);

      // Act.
      // Make it look like it's finished loading.
      gridElement.loadingState = RequestState.SUCCEEDED;
      await gridElement.updateComplete;

      // Assert.
      // This should have forced it to try loading more data.
      expect(loadMoreDataHandler).toBeCalledTimes(1);
    });

    it("responds to a change in the content size", async () => {
      // Arrange.
      // Make it look like the user has scrolled down.
      Object.defineProperty(gridElement, "scrollTop", { value: 500 });

      // Act.
      // Simulate a change in the content size, which should cause it to
      // check whether to load more data.
      // Get the ResizeObserver instance.
      expect(mockResizeObserver).toBeCalledTimes(2);
      // Get the callback.
      const observeCallback = mockResizeObserver.mock.calls[1][0];

      // Call the callback.
      observeCallback();

      // Assert.
      // It should have tried to load more data.
      expect(loadMoreDataHandler).toBeCalledTimes(1);
    });

    describe("visibility tracking", () => {
      /**
       * Images in the first section.
       */
      let section1Images: EntitiesAndIds;
      /**
       * Images in the second section.
       */
      let section2Images: EntitiesAndIds;

      /**
       * Mock function to use for setting custom bounding rectangles.
       */
      const mockGetBoundingClientRect = jest.fn();

      beforeEach(async () => {
        const section1CaptureDate = faker.date.past();
        const section2CaptureDate = faker.date.past();
        const section1SessionName = faker.lorem.words();
        const section2SessionName = faker.lorem.words();

        // First, make it look like we have thumbnails in two sections.
        const state = fakeState();
        section1Images = fakeArtifactEntities(
          faker.datatype.number({ min: 1, max: 25 }),
          true,
          undefined,
          section1CaptureDate,
          section1SessionName
        );
        section2Images = fakeArtifactEntities(
          faker.datatype.number({ min: 1, max: 25 }),
          true,
          undefined,
          section2CaptureDate,
          section2SessionName
        );
        state.imageView.ids = section1Images.ids.concat(section2Images.ids);
        lodash.assign(
          state.imageView.entities,
          section1Images.entities,
          section2Images.entities
        );
        state.imageView.currentQueryHasMorePages = true;

        // Set the state correctly.
        Object.assign(gridElement, gridElement.mapState(state));
        await gridElement.updateComplete;

        // Make it look like the user has scrolled down.
        Object.assign(gridElement, { scrollTop: 500 });

        // Set up a fake handler for the event to load more data at the bottom.
        // It will automatically set the status to "loading" after the first load event
        // to simulate actual behavior and avoid an infinite loop.
        loadMoreDataHandler = jest.fn(
          (_) => (gridElement.loadingState = RequestState.LOADING)
        );
        gridElement.addEventListener(
          ConnectedThumbnailGrid.LOAD_MORE_DATA_BOTTOM_EVENT_NAME,
          loadMoreDataHandler
        );

        // Set a plausible size for the viewport.
        Object.defineProperty(window, "innerHeight", {
          value: 1000,
        });

        // It might have updated visibility, so clear the mocks so that the
        // tests don't get confused.
        for (const section of getAllSections()) {
          (section as MockThumbnailGridSection).clearThumbnails.mockClear();
          (section as MockThumbnailGridSection).reloadThumbnails.mockClear();
          (
            section as MockThumbnailGridSection
          ).enableVisibilityTracking.mockClear();
          (
            section as MockThumbnailGridSection
          ).disableVisibilityTracking.mockClear();
        }
      });

      /**
       * Sets things up so that it looks like the top section is not visible.
       */
      function setUpTopSectionInvisible() {
        // Arrange.
        // Make it look like one of the sections is no longer visible.
        mockGetBoundingClientRect.mockReturnValue({
          top: -1000,
          bottom: -600,
          left: 0,
          right: 2000,
        });
        const topSection = getSectionElement(0);
        Object.assign(topSection, {
          getBoundingClientRect: mockGetBoundingClientRect,
        });

        // Act.
        // Simulate the user scrolling, which should cause it to clear excess
        // data.
        gridElement.dispatchEvent(new Event("scroll"));
      }

      it("clears the sections on top when enough data are loaded", () => {
        // Act.
        setUpTopSectionInvisible();

        // Assert.
        // It should have checked the visibility of the top section.
        expect(mockGetBoundingClientRect).toBeCalled();
        // It should have loaded additional data.
        expect(loadMoreDataHandler).toBeCalledTimes(1);

        // It should have created two sections.
        const topSection = getSectionElement(0);
        // It should have deleted data from the top section.
        expect(topSection.clearThumbnails).toBeCalledTimes(1);
        expect(topSection.disableVisibilityTracking).toBeCalledTimes(1);
      });

      it("reloads data on the top when necessary", () => {
        // Arrange.
        setUpTopSectionInvisible();

        // Make it look like the top section is visible again.
        const mockGetBoundingClientRect = jest.fn();
        mockGetBoundingClientRect.mockReturnValue({
          top: -300,
          bottom: 200,
          left: 0,
          right: 2000,
        });
        const topSection = getSectionElement(0);
        Object.assign(topSection, {
          getBoundingClientRect: mockGetBoundingClientRect,
        });

        // Act.
        // This should now reload the data on top.
        gridElement.dispatchEvent(new Event("scroll"));

        // Assert.
        // It should have first deleted the top section.
        expect(topSection.clearThumbnails).toBeCalledTimes(1);
        expect(topSection.disableVisibilityTracking).toBeCalledTimes(1);
        // It should have re-enabled visibility tracking on the top.
        expect(topSection.enableVisibilityTracking).toBeCalledTimes(1);
      });

      /**
       * Sets things up so that it looks like the bottom section is not visible.
       */
      function setUpBottomSectionInvisible() {
        // Arrange.
        // Make it look like the bottom section is no longer visible.
        mockGetBoundingClientRect.mockReturnValue({
          top: 1600,
          bottom: 1900,
          left: 0,
          right: 2000,
        });
        const bottomSection = getSectionElement(1);
        Object.assign(bottomSection, {
          getBoundingClientRect: mockGetBoundingClientRect,
        });

        // Act.
        // Simulate the user scrolling, which should cause it to clear excess
        // data.
        gridElement.dispatchEvent(new Event("scroll"));
      }

      it("deletes data on the bottom when necessary", () => {
        // Act.
        setUpBottomSectionInvisible();

        // Assert.
        // It should have checked the visibility of the bottom section.
        expect(mockGetBoundingClientRect).toBeCalled();
        // It should have loaded additional data.
        expect(loadMoreDataHandler).toBeCalledTimes(1);
        // It should have deleted data once.
        const bottomSection = getSectionElement(1);
        expect(bottomSection.clearThumbnails).toBeCalledTimes(1);
        expect(bottomSection.disableVisibilityTracking).toBeCalledTimes(1);
      });

      it("reloads data on the bottom when necessary", () => {
        // Arrange.
        setUpBottomSectionInvisible();

        // Make it look like the bottom section is visible again.
        const mockGetBoundingClientRect = jest.fn();
        mockGetBoundingClientRect.mockReturnValue({
          top: 800,
          bottom: 1600,
          left: 0,
          right: 2000,
        });
        const bottomSection = getSectionElement(1);
        Object.assign(bottomSection, {
          getBoundingClientRect: mockGetBoundingClientRect,
        });

        // Act.
        // This should now reload the data on top.
        gridElement.dispatchEvent(new Event("scroll"));

        // Assert.
        // It should have first deleted the bottom section.
        expect(bottomSection.clearThumbnails).toBeCalledTimes(1);
        expect(bottomSection.disableVisibilityTracking).toBeCalledTimes(1);
        // It should have re-enabled visibility tracking on the bottom section.
        expect(bottomSection.enableVisibilityTracking).toBeCalledTimes(1);
      });

      it("does not clear or reload any data when it doesn't need to", () => {
        // Act.
        // By default, a scroll event should do nothing as long as both
        // elements are visible.
        gridElement.dispatchEvent(new Event("scroll"));

        // Assert.
        const topSection = getSectionElement(0);
        const bottomSection = getSectionElement(1);

        // It should not have deleted data.
        expect(topSection.clearThumbnails).not.toBeCalled();
        expect(bottomSection.clearThumbnails).not.toBeCalled();
        expect(topSection.disableVisibilityTracking).not.toBeCalled();
        expect(bottomSection.disableVisibilityTracking).not.toBeCalled();
        // It should not have reloaded anything.
        expect(topSection.reloadThumbnails).not.toBeCalled();
        expect(bottomSection.reloadThumbnails).not.toBeCalled();
        expect(topSection.enableVisibilityTracking).not.toBeCalled();
        expect(bottomSection.enableVisibilityTracking).not.toBeCalled();
      });

      it("propagates scroll events to the section elements", () => {
        // Arrange.
        // Listen for scroll events on the sections.
        const scrollEventHandler = jest.fn();
        for (const section of getAllSections()) {
          section.addEventListener("scroll", scrollEventHandler);
        }

        // Act.
        gridElement.dispatchEvent(new Event("scroll"));

        // Assert.
        // It should have dispatched a scroll event on all the sections.
        expect(scrollEventHandler).toBeCalledTimes(getAllSections().length);
      });

      it("supports enabling or disabling tracking twice", () => {
        // Act and assert.
        expect(gridElement.isTrackingEnabled).toEqual(true);

        gridElement.disableVisibilityTracking();
        gridElement.disableVisibilityTracking();

        expect(gridElement.isTrackingEnabled).toEqual(false);

        gridElement.enableVisibilityTracking();
        gridElement.enableVisibilityTracking();

        expect(gridElement.isTrackingEnabled).toEqual(true);
      });

      it("responds to a change in the content size", async () => {
        // Arrange.
        // Make it look like the top section is invisible.
        setUpTopSectionInvisible();

        // Act.
        // Simulate a change in the content size, which should cause it to
        // update visibility.
        // Get the ResizeObserver instance.
        expect(mockResizeObserver).toBeCalledTimes(2);
        // Get the callback.
        const observeCallback = mockResizeObserver.mock.calls[0][0];

        // Call the callback.
        observeCallback();

        // Assert.
        // It should have cleared the top section.
        const topSection = getSectionElement(0);
        expect(topSection.clearThumbnails).toBeCalledTimes(1);
      });
    });

    it("does not load data if it doesn't need to", () => {
      // Arrange.
      // Make it look like the user has not scrolled down.
      Object.defineProperty(gridElement, "scrollTop", { value: 0 });

      // Act.
      // Simulate scrolling to trigger an update.
      gridElement.dispatchEvent(new Event("scroll"));

      // Assert.
      // It should not have tried to load more data.
      expect(loadMoreDataHandler).toBeCalledTimes(0);
    });

    it("does not load data if it's already loading", () => {
      // Arrange.
      // Make it look like the user has scrolled down.
      Object.defineProperty(gridElement, "scrollTop", { value: 500 });

      // Make it look like it's loading.
      gridElement.loadingState = RequestState.LOADING;

      // Act.
      // Simulate scrolling to trigger an update.
      gridElement.dispatchEvent(new Event("scroll"));

      // Assert.
      // It should not have tried to load more data.
      expect(loadMoreDataHandler).toBeCalledTimes(0);
    });

    it("stops loading when there are no more data", () => {
      // Arrange.
      Object.defineProperty(gridElement, "scrollTop", { value: 500 });

      // Make it look like we have no more data to load.
      gridElement.loadingState = RequestState.SUCCEEDED;
      gridElement.hasMorePages = false;

      // Act.
      // Simulate scrolling to trigger an update.
      gridElement.dispatchEvent(new Event("scroll"));

      // Assert.
      // It should not have tried to load more data.
      expect(loadMoreDataHandler).toBeCalledTimes(0);
    });
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
      const image = fakeImageWithStatus();

      // Create a fake state.
      const state: RootState = fakeState();
      state.imageView.ids = [image.id];
      state.imageView.entities[image.id] = fakeArtifactEntity(
        true,
        false,
        undefined,
        undefined,
        undefined,
        image.selected
      );
      state.imageView.currentQueryState = contentState;
      state.imageView.metadataLoadingState = metadataState;
      state.imageView.lastScrollLocation = faker.datatype.number();

      // Act.
      const updates = gridElement.mapState(state);

      // Assert.
      // It should have gotten the correct updates.
      expect(updates).toHaveProperty("groupedArtifactsFlatIds");
      expect(new Set(updates["groupedArtifactsFlatIds"])).toEqual(
        new Set([image])
      );
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

      expect(updates["savedScrollHeight"]).toEqual(
        state.imageView.lastScrollLocation
      );
    }
  );

  it("does not include artifacts that have no metadata", () => {
    // Arrange.
    const imageId = faker.datatype.uuid();

    // Create a fake state.
    const state: RootState = fakeState();
    state.imageView.ids = [imageId];
    const entity = fakeArtifactEntity(false, false);
    entity.metadata = null;
    state.imageView.entities[imageId] = entity;

    // Act.
    const updates = gridElement.mapState(state);

    // Assert.
    // There should be no grouped images, because our input lacks metadata.
    expect(updates).toHaveProperty("groupedArtifacts");
    expect(updates["groupedArtifacts"]).toEqual([]);
  });

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
    const image1 = fakeImageWithStatus();
    const image2 = fakeImageWithStatus();
    const image3 = fakeImageWithStatus();
    const image4 = fakeImageWithStatus();
    const allImages = [image1, image2, image3, image4];

    // Create a fake state.
    const state: RootState = fakeState();
    state.imageView.ids = allImages.map((i) => i.id);

    // Make it look like the capture date is the same for two of them.
    const captureDate1 = faker.date.past();
    // Make sure one date is a day before the other.
    const captureDate2 = new Date(captureDate1.getTime() - 1000 * 60 * 60 * 24);
    // Make it look like there are two sessions.
    const session1 = "a" + faker.lorem.words();
    const session2 = "b" + faker.lorem.words();

    state.imageView.entities[image1.id] = fakeArtifactEntity(
      true,
      undefined,
      captureDate1,
      session1,
      undefined,
      image1.selected
    );
    state.imageView.entities[image2.id] = fakeArtifactEntity(
      true,
      undefined,
      captureDate1,
      session1,
      undefined,
      image2.selected
    );
    state.imageView.entities[image3.id] = fakeArtifactEntity(
      true,
      undefined,
      captureDate2,
      session1,
      undefined,
      image3.selected
    );
    state.imageView.entities[image4.id] = fakeArtifactEntity(
      true,
      undefined,
      captureDate2,
      session2,
      undefined,
      image4.selected
    );

    // Act.
    const updates = gridElement.mapState(state);

    // Assert.
    // It should have gotten the correct updates.
    expect(updates).toHaveProperty("groupedArtifactsFlatIds");
    expect(new Set(updates["groupedArtifactsFlatIds"])).toEqual(
      new Set(allImages)
    );

    // It should have grouped things correctly.
    expect(updates).toHaveProperty("groupedArtifacts");
    const groups = updates["groupedArtifacts"];
    expect(groups).toHaveLength(3);

    // They should be sorted in order by date, descending.
    expect(groups[0].captureDate).toEqual(captureDate1);
    // It might re-order it based on entity names, which is why we convert to
    // sets.
    expect(new Set(groups[0].imageIds)).toEqual(
      new Set([image1.id, image2.id])
    );

    expect(groups[1].captureDate).toEqual(captureDate2);
    expect(groups[1].imageIds).toEqual([image3.id]);

    expect(groups[2].captureDate).toEqual(captureDate2);
    expect(groups[2].imageIds).toEqual([image4.id]);

    // It should have recorded the order as well.
    expect(updates).toHaveProperty("groupedArtifactsOrder");
    const artifactOrder: Map<string, number> = updates["groupedArtifactsOrder"];
    // The order should match with the groups.
    expect(artifactOrder.get(image1.id)).toBeLessThan(
      artifactOrder.get(image3.id) as number
    );
    expect(artifactOrder.get(image2.id)).toBeLessThan(
      artifactOrder.get(image3.id) as number
    );
    expect(artifactOrder.get(image3.id)).toBeLessThan(
      artifactOrder.get(image4.id) as number
    );
  });

  each([
    ["no query is running", false],
    ["a query is running", true],
  ]).it(
    `maps the correct actions to the ${ConnectedThumbnailGrid.LOAD_MORE_DATA_BOTTOM_EVENT_NAME} event when %s`,
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

  it("maps the correct actions to the click event", () => {
    // Arrange.
    // Set a reasonable scroll distance.
    gridElement.scrollTop = faker.datatype.number();

    // Act.
    const eventMap = gridElement.mapEvents();

    // Assert.
    // It should have a mapping for the proper events.
    expect(eventMap).toHaveProperty("click");

    // This should fire the appropriate action creator.
    eventMap["click"](new Event("click"));

    expect(mockSetScrollLocation).toBeCalledWith(gridElement.scrollTop);
  });

  each([
    ["selecting 1", [false, false, false], 0, [true, false, false]],
    ["selecting 2", [true, false, false], 1, [true, true, false]],
    ["selecting 3", [true, false, false], 2, [true, true, true]],
    ["selecting the last", [false, false, false], 2, [false, false, true]],
    ["selecting the last 2", [false, true, false], 2, [false, true, true]],
  ]).it(
    "maps the correct actions to the shift selected event when %s",
    (
      _,
      initialSelection: boolean[],
      selectIndex: number,
      newSelection: boolean[]
    ) => {
      // Arrange.
      // Set some displayed artifacts.
      const images = [];
      for (let i = 0; i < initialSelection.length; ++i) {
        images.push(fakeImageWithStatus(initialSelection[i]));
      }

      gridElement.groupedArtifactsFlatIds = images;
      gridElement.groupedArtifactsOrder = new Map(
        images.map((image, index) => [image.id, index])
      );

      // Act.
      const eventMap = gridElement.mapEvents();

      // Assert.
      // It should have a mapping for the proper events.
      expect(eventMap).toHaveProperty(
        ArtifactThumbnail.SHIFT_SELECTED_EVENT_NAME
      );
      // This should fire the appropriate action creator.
      eventMap[ArtifactThumbnail.SHIFT_SELECTED_EVENT_NAME](
        new CustomEvent<string>(ArtifactThumbnail.SHIFT_SELECTED_EVENT_NAME, {
          detail: images[selectIndex].id,
        })
      );

      // It should have called the action creator.
      expect(mockThunkSelectImages).toBeCalledTimes(1);

      // It should have selected the proper images.
      const gotSelection = new Set(
        mockThunkSelectImages.mock.calls[0][0].imageIds
      );
      for (let i = 0; i < newSelection.length; ++i) {
        if (newSelection[i]) {
          expect(gotSelection).toContain(images[i].id);
        } else {
          expect(gotSelection).not.toContain(images[i].id);
        }
      }
    }
  );
});
