import {
  ConnectedLargeImageDisplay,
  LargeImageDisplay,
} from "../large-image-display";
import {
  fakeImageEntity,
  fakeState,
  getShadowRoot,
} from "./element-test-utils";
import { RootState } from "../types";
import {
  thunkLoadImage,
  thunkClearFullSizedImage,
} from "../thumbnail-grid-slice";
import each from "jest-each";

// I know this sounds insane, but when I import this as an ES6 module, faker.seed() comes up
// undefined. I can only assume this is a quirk in Babel.
const faker = require("faker");

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
    thunkClearFullSizedImage: jest.fn(),
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

describe("large-image-display", () => {
  /** Internal large-image-display to use for testing. */
  let imageElement: ConnectedLargeImageDisplay;

  beforeAll(() => {
    // Manually register the custom element.
    customElements.define(
      ConnectedLargeImageDisplay.tagName,
      ConnectedLargeImageDisplay
    );
  });

  beforeEach(() => {
    // Set a faker seed.
    faker.seed(1337);

    imageElement = window.document.createElement(
      ConnectedLargeImageDisplay.tagName
    ) as ConnectedLargeImageDisplay;
    document.body.appendChild(imageElement);
  });

  afterEach(() => {
    document.body.getElementsByTagName(LargeImageDisplay.tagName)[0].remove();
  });

  it("can be rendered", async () => {
    // Act.
    await imageElement.updateComplete;

    // Assert.
    expect(imageElement.frontendId).toBeUndefined();

    // It should have added the ResizeObserver.
    expect(mockResizeObserver).toBeCalledTimes(1);
    const mockResizeObserverInstance = mockResizeObserver.mock.results[0].value;
    expect(mockResizeObserverInstance.observe).toBeCalledWith(imageElement);
  });

  it("fires an event when the image is updated", async () => {
    // Arrange.
    // Setup a fake handler for our event.
    const handler = jest.fn();
    imageElement.addEventListener(
      ConnectedLargeImageDisplay.ARTIFACT_CHANGED_EVENT_NAME,
      handler
    );

    // Act.
    imageElement.frontendId = faker.datatype.uuid();

    await imageElement.updateComplete;

    // Assert.
    // It should have caught the event.
    expect(handler).toBeCalledTimes(1);
  });

  it("sets the image size when the image is updated", async () => {
    // Arrange.
    // Set the screen height.
    const screenHeight = faker.datatype.number();
    Object.defineProperty(imageElement, "clientHeight", {
      value: screenHeight,
    });

    // Act.
    // Update the image.
    imageElement.imageUrl = faker.image.imageUrl();
    // Wait for it to render.
    await imageElement.updateComplete;

    // Assert.
    // It should have set the height of the underlying elements.
    const root = getShadowRoot(ConnectedLargeImageDisplay.tagName);
    const containerElement = root.querySelector(
      "#image_container"
    ) as HTMLElement;
    const internalImage = root.querySelector("#image") as HTMLImageElement;

    expect(containerElement.style.height).toEqual(`${screenHeight}px`);
    expect(internalImage.style.height).toEqual(`${screenHeight}px`);
  });

  each([
    ["not specified", undefined],
    ["not loaded", faker.datatype.uuid()],
  ]).it(
    "updates from the Redux state when the image is %s",
    (_, frontendId: string) => {
      // Arrange.
      // Set the image ID.
      imageElement.frontendId = frontendId;

      // Create a fake state.
      const state: RootState = fakeState();
      // Make it look like the image is not loaded.
      const imageEntity = fakeImageEntity(undefined, false);
      state.imageView.ids = [frontendId];
      state.imageView.entities[frontendId] = imageEntity;

      // Act.
      const updates = imageElement.mapState(state);

      // Assert.
      // It should have set the frontend ID.
      expect(updates).toEqual({});
    }
  );

  it("updates from the Redux state when the image is loaded", () => {
    // Arrange.
    // Set the frontend ID.
    const imageId = faker.datatype.uuid();
    imageElement.frontendId = imageId;

    // Create a fake state.
    const state: RootState = fakeState();
    // Make it look like the image is loaded.
    const imageEntity = fakeImageEntity(undefined, true);
    state.imageView.ids = [imageId];
    state.imageView.entities[imageId] = imageEntity;

    // Act.
    const updates = imageElement.mapState(state);

    // Assert.
    // It should have set the image URL.
    expect(updates).toEqual({ imageUrl: imageEntity.imageUrl });
  });

  it("maps the correct actions to the image changed event", () => {
    // Arrange.
    const imageId = faker.datatype.uuid();

    // Act.
    const eventMap = imageElement.mapEvents();

    // Assert.
    // It should have a mapping for the proper events.
    expect(eventMap).toHaveProperty(
      ConnectedLargeImageDisplay.ARTIFACT_CHANGED_EVENT_NAME
    );

    // This should fire the appropriate action creator.
    const testEvent = { detail: imageId };
    eventMap[ConnectedLargeImageDisplay.ARTIFACT_CHANGED_EVENT_NAME](
      testEvent as unknown as Event
    );

    // Check image changed event.
    expect(thunkLoadImage).toBeCalledTimes(1);
    expect(thunkLoadImage).toBeCalledWith(testEvent.detail);
  });

  it("maps the correct action to the disconnected event", () => {
    // Act.
    const eventMap = imageElement.mapEvents();

    // Assert.
    // It should have a mapping for the proper events.
    expect(eventMap).toHaveProperty(
      ConnectedLargeImageDisplay.DISCONNECTED_EVENT_NAME
    );

    // This should fire the appropriate action creator.
    const testEvent = { detail: faker.datatype.uuid() };
    eventMap[ConnectedLargeImageDisplay.DISCONNECTED_EVENT_NAME](
      testEvent as unknown as Event
    );

    // Check disconnected event.
    expect(thunkClearFullSizedImage).toBeCalledTimes(1);
    expect(thunkClearFullSizedImage).toBeCalledWith(testEvent.detail);
  });
});
