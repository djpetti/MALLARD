import {
  ConnectedLargeArtifactDisplay,
  LargeArtifactDisplay,
} from "../large-artifact-display";
import {
  fakeArtifactEntity,
  fakeState,
  getShadowRoot,
} from "./element-test-utils";
import { RootState } from "../types";
import {
  clearVideoUrl,
  setVideoUrl,
  thunkClearFullSizedImages,
  thunkLoadImage,
} from "../thumbnail-grid-slice";
import each from "jest-each";
import { faker } from "@faker-js/faker";
import { ObjectType } from "mallard-api";

jest.mock("@captaincodeman/redux-connect-element", () => ({
  // Turn connect() into a pass-through.
  connect: jest.fn((_, elementClass) => elementClass),
}));
jest.mock("../thumbnail-grid-slice", () => {
  const actualSlice = jest.requireActual("../thumbnail-grid-slice");

  return {
    createImageEntityId: jest.fn(),
    thunkLoadImage: jest.fn(),
    addArtifact: jest.fn(),
    thunkClearFullSizedImages: jest.fn(),
    setVideoUrl: jest.fn(),
    clearVideoUrl: jest.fn(),
    thumbnailGridSelectors: {
      // Use the actual implementation for this function, but spy on calls.
      selectById: jest.spyOn(actualSlice.thumbnailGridSelectors, "selectById"),
    },
  };
});
jest.mock("../store", () => ({
  // Mock this to avoid an annoying spurious console error from Redux.
  configureStore: jest.fn(),
}));

// Mock the ResizeObserver class, because JSDom doesn't implement it.
const mockResizeObserver = jest.fn(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));
global.ResizeObserver = mockResizeObserver;

// Use fake timers.
jest.useFakeTimers();
jest.spyOn(window, "setInterval");
jest.spyOn(window, "clearInterval");

describe("large-artifact-display", () => {
  /** Internal large-image-display to use for testing. */
  let displayElement: ConnectedLargeArtifactDisplay;

  beforeAll(() => {
    // Manually register the custom element.
    customElements.define(
      ConnectedLargeArtifactDisplay.tagName,
      ConnectedLargeArtifactDisplay
    );
  });

  beforeEach(() => {
    // Set a faker seed.
    faker.seed(1337);

    displayElement = window.document.createElement(
      ConnectedLargeArtifactDisplay.tagName
    ) as ConnectedLargeArtifactDisplay;
    document.body.appendChild(displayElement);
  });

  afterEach(() => {
    document.body
      .getElementsByTagName(LargeArtifactDisplay.tagName)[0]
      .remove();
  });

  it("can be rendered", async () => {
    // Act.
    await displayElement.updateComplete;

    // Assert.
    expect(displayElement.frontendId).toBeUndefined();

    // It should have added the ResizeObserver.
    expect(mockResizeObserver).toBeCalledTimes(1);
    const mockResizeObserverInstance = mockResizeObserver.mock.results[0].value;
    expect(mockResizeObserverInstance.observe).toBeCalledWith(displayElement);
  });

  it("renders the transcoding message when the video fails to load", async () => {
    // Arrange.
    displayElement.type = ObjectType.VIDEO;
    displayElement.sourceUrl = faker.internet.url();

    // Act.
    await displayElement.updateComplete;

    // Make it look like loading failed with an error.
    const root = getShadowRoot(ConnectedLargeArtifactDisplay.tagName);
    const videoElement = root.querySelector("#media") as HTMLVideoElement;
    expect(videoElement).not.toBeNull();
    videoElement.dispatchEvent(new Event("error"));

    await displayElement.updateComplete;

    // Assert.
    // It should be displaying the transcoding message.
    let transcodingMessageElement = root.querySelector(
      ".transcode_message_background"
    ) as HTMLDivElement;
    expect(transcodingMessageElement).not.toBeNull();

    // It should have set a timer to try reloading the video.
    expect(window.setInterval).toBeCalledTimes(1);

    // Act.
    // Wait for the timer to run.
    jest.runOnlyPendingTimers();

    await displayElement.updateComplete;

    // Assert.
    // It should have cleared the timer again.
    expect(window.clearInterval).toBeCalledTimes(1);

    // It should have not rendered the transcoding message.
    transcodingMessageElement = root.querySelector(
      ".transcode_message_background"
    ) as HTMLDivElement;
    expect(transcodingMessageElement).toBeNull();
  });

  it("fires an event when the image is updated", async () => {
    // Arrange.
    // Setup a fake handler for our event.
    const handler = jest.fn();
    displayElement.addEventListener(
      ConnectedLargeArtifactDisplay.ARTIFACT_CHANGED_EVENT_NAME,
      handler
    );

    // Act.
    displayElement.frontendId = faker.datatype.uuid();

    await displayElement.updateComplete;

    // Assert.
    // It should have caught the event.
    expect(handler).toBeCalledTimes(1);
  });

  each([
    ["landscape", 1920, 1080],
    ["portrait", 1080, 1920],
  ]).it(
    "sets the image size when the image is updated in %s orientation",
    async (_, screenWidth: number, screenHeight: number) => {
      // Arrange.
      // Set the screen size.
      Object.defineProperty(displayElement, "clientHeight", {
        value: screenHeight,
      });
      Object.defineProperty(displayElement, "clientWidth", {
        value: screenWidth,
      });
      Object.defineProperty(window, "innerHeight", {
        value: screenHeight,
      });
      Object.defineProperty(window, "innerWidth", {
        value: screenWidth,
      });

      // Set up the bounding rectangle check.
      const mockGetBoundingClientRect = jest.fn();
      const imageWidth = screenWidth / 2;
      const imageHeight = screenHeight / 3;
      mockGetBoundingClientRect.mockReturnValue({
        width: imageWidth,
        height: imageHeight,
      });

      // Act.
      // Update the image.
      displayElement.sourceUrl = faker.image.image(undefined, undefined, true);
      // Wait for it to render.
      await displayElement.updateComplete;

      const root = getShadowRoot(ConnectedLargeArtifactDisplay.tagName);
      const containerElement = root.querySelector(
        "#media_container"
      ) as HTMLElement;
      const internalImage = root.querySelector("#media") as HTMLImageElement;

      // Mock out the boundingClientRectangle check.
      Object.assign(internalImage, {
        getBoundingClientRect: mockGetBoundingClientRect,
      });

      // Force it to adjust sizes again.
      displayElement.sourceUrl = faker.image.image(undefined, undefined, true);
      await displayElement.updateComplete;

      // Assert.
      if (screenWidth > screenHeight) {
        // It should have set the height of the underlying elements.
        expect(containerElement.style.height).toEqual(`${screenHeight}px`);
        // Image should be sized so as not to overflow.
        expect(internalImage.style.height).toEqual(
          `${(imageHeight / imageWidth) * screenWidth}px`
        );
      } else {
        // In portrait mode, it should not mess with the sizing.
        expect(containerElement.style.height).toEqual("auto");
        expect(internalImage.style.height).toEqual("auto");
      }
    }
  );

  each([
    ["not specified", undefined, ObjectType.IMAGE, false],
    ["not loaded", faker.datatype.uuid(), ObjectType.IMAGE, false],
    ["a loaded image", faker.datatype.uuid(), ObjectType.IMAGE, true],
    ["a video", faker.datatype.uuid(), ObjectType.VIDEO, false],
  ]).it(
    "updates from the Redux state when the artifact is %s",
    (_, frontendId: string, artifactType: ObjectType, imageLoaded: boolean) => {
      // Arrange.
      // Set the image ID.
      displayElement.frontendId = frontendId;

      // Create a fake state.
      const state: RootState = fakeState();
      // Make it look like the image is not loaded.
      const entity = fakeArtifactEntity(
        undefined,
        imageLoaded,
        undefined,
        undefined,
        artifactType
      );
      state.imageView.ids = [frontendId];
      state.imageView.entities[frontendId] = entity;

      // Act.
      const updates = displayElement.mapState(state);

      // Assert.
      if (
        frontendId == undefined ||
        (artifactType === ObjectType.IMAGE && !imageLoaded)
      ) {
        // It should have ignored the update for images, and if there is no
        // frontend ID.
        expect(updates).toEqual({});
      } else if (artifactType === ObjectType.IMAGE && imageLoaded) {
        // It should set the correct data for a loaded image.
        expect(updates).toEqual({
          sourceUrl: entity.artifactUrl,
          metadata: entity.metadata,
          type: artifactType,
        });
      } else {
        // It should not check loading status for videos, because videos are
        // streamed instead of preloaded.
        expect(updates).toEqual({
          sourceUrl: entity.streamableUrl,
          metadata: entity.metadata,
          type: artifactType,
        });
      }
    }
  );

  it("updates from the Redux state when the image is loaded", () => {
    // Arrange.
    // Set the frontend ID.
    const imageId = faker.datatype.uuid();
    displayElement.frontendId = imageId;

    // Create a fake state.
    const state: RootState = fakeState();
    // Make it look like the image is loaded.
    const entity = fakeArtifactEntity(undefined, true);
    state.imageView.ids = [imageId];
    state.imageView.entities[imageId] = entity;

    // Act.
    const updates = displayElement.mapState(state);

    // Assert.
    // It should have set the source URL.
    expect(updates).toEqual({
      sourceUrl: entity.artifactUrl,
      metadata: entity.metadata,
      type: entity.backendId.type,
    });
  });

  each([
    ["images", ObjectType.IMAGE],
    ["videos", ObjectType.VIDEO],
  ]).it(
    "maps the correct actions to the artifact changed event for %s",
    (_: string, artifactType: ObjectType) => {
      // Arrange.
      const imageId = faker.datatype.uuid();
      displayElement.type = artifactType;

      // Act.
      const eventMap = displayElement.mapEvents();

      // Assert.
      // It should have a mapping for the proper events.
      expect(eventMap).toHaveProperty(
        ConnectedLargeArtifactDisplay.ARTIFACT_CHANGED_EVENT_NAME
      );

      // This should fire the appropriate action creator.
      const testEvent = { detail: imageId };
      eventMap[ConnectedLargeArtifactDisplay.ARTIFACT_CHANGED_EVENT_NAME](
        testEvent as unknown as Event
      );

      // Check image changed event.
      if (artifactType == ObjectType.IMAGE) {
        expect(thunkLoadImage).toBeCalledTimes(1);
        expect(thunkLoadImage).toBeCalledWith(testEvent.detail);
      } else {
        expect(setVideoUrl).toBeCalledTimes(1);
        expect(setVideoUrl).toBeCalledWith(testEvent.detail);
      }
    }
  );

  each([
    ["images", ObjectType.IMAGE],
    ["videos", ObjectType.VIDEO],
  ]).it(
    "maps the correct action to the disconnected event for %s",
    (_: string, artifactType: ObjectType) => {
      // Arrange.
      displayElement.type = artifactType;

      // Act.
      const eventMap = displayElement.mapEvents();

      // Assert.
      // It should have a mapping for the proper events.
      expect(eventMap).toHaveProperty(
        ConnectedLargeArtifactDisplay.DISCONNECTED_EVENT_NAME
      );

      // This should fire the appropriate action creator.
      const testEvent = { detail: faker.datatype.uuid() };
      eventMap[ConnectedLargeArtifactDisplay.DISCONNECTED_EVENT_NAME](
        testEvent as unknown as Event
      );

      // Check disconnected event.
      if (artifactType == ObjectType.IMAGE) {
        expect(thunkClearFullSizedImages).toBeCalledTimes(1);
        expect(thunkClearFullSizedImages).toBeCalledWith([testEvent.detail]);
      } else {
        expect(clearVideoUrl).toBeCalledTimes(1);
        expect(clearVideoUrl).toBeCalledWith(testEvent.detail);
      }
    }
  );
});
