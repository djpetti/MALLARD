import {
  ConnectedLargeImageDisplay,
  LargeImageDisplay,
} from "../large-image-display";
import {
  fakeImageEntity,
  fakeObjectRef,
  fakeState,
  getShadowRoot,
} from "./element-test-utils";
import { RootState } from "../types";
import each from "jest-each";
import { ObjectRef } from "typescript-axios";
import { ImageIdentifier } from "../image-display";
import {createImageEntityId, thunkLoadImage, addArtifact, thunkClearFullSizedImage, thumbnailGridSelectors} from "../thumbnail-grid-slice";

// I know this sounds insane, but when I import this as an ES6 module, faker.seed() comes up
// undefined. I can only assume this is a quirk in Babel.
const faker = require("faker");

// Using older require syntax here so we get the correct mock type.
jest.mock("../thumbnail-grid-slice", () => {
  return {
    createImageEntityId: jest.fn(),
    thunkLoadImage: jest.fn(),
    addArtifact: jest.fn(),
    thunkClearFullSizedImage: jest.fn(),
    thumbnailGridSelectors: jest.requireActual("../thumbnail-grid-slice")
  }
})

jest.mock("@captaincodeman/redux-connect-element", () => ({
  // Turn connect() into a pass-through.
  connect: jest.fn((_, elementClass) => elementClass),
}));
jest.mock("../thumbnail-grid-slice", () => ({
  createImageEntityId: jest.fn(),
  thunkLoadImage: jest.fn(),
  addArtifact: jest.fn(),
  thunkClearFullSizedImage: jest.fn(),
  thumbnailGridSelectors: { selectById: jest.fn() },
}));
jest.mock("../store", () => ({
  // Mock this to avoid an annoying spurious console error from Redux.
  configureStore: jest.fn(),
}));

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

    // Use the actual implementation for this function.
    thumbnailGridSelectors.selectById.mockImplementation(
      thumbnailGridSelectors.selectById
    );

    imageElement = window.document.createElement(
      ConnectedLargeImageDisplay.tagName
    ) as ConnectedLargeImageDisplay;
    document.body.appendChild(imageElement);
  });

  afterEach(() => {
    document.body.getElementsByTagName(LargeImageDisplay.tagName)[0].remove();
  });

  it("can be instantiated", () => {
    // Assert.
    expect(imageElement.frontendId).toBeUndefined();
  });

  it("fires an event when the image is updated", async () => {
    // Arrange.
    // Fake image ID to use for testing.
    const fakeBackendId = fakeObjectRef();

    // Setup a fake handler for our event.
    const handler = jest.fn();
    imageElement.addEventListener(
      ConnectedLargeImageDisplay.IMAGE_CHANGED_EVENT_NAME,
      handler
    );

    // Act.
    imageElement.backendBucket = fakeBackendId.bucket;
    imageElement.backendName = fakeBackendId.name;

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
    ["the backend ID is not set", undefined],
    ["the backend ID is set", fakeObjectRef()],
  ]).it(
    "updates from the Redux state when no image is registered and %s",
    (_: string, backendId?: ObjectRef) => {
      // Arrange.
      if (backendId) {
        // Set the backend ID if we have it.
        imageElement.backendBucket = backendId.bucket;
        imageElement.backendName = backendId.name;
      }

      // Create a fake state.
      const state: RootState = fakeState();

      // Set up the frontend ID.
      createImageEntityId.mockReturnValue(faker.datatype.uuid());

      // Act.
      const updates = imageElement.mapState(state);

      // Assert.
      // It should have changed nothing.
      expect(updates).toEqual({});

      if (backendId) {
        // It should have checked the frontend state.
        expect(thumbnailGridSelectors.selectById).toBeCalledTimes(1);
      }
    }
  );

  it("updates from the Redux state when the image is not loaded", () => {
    // Arrange.
    // Set the backend ID.
    const backendId = fakeObjectRef();
    imageElement.backendBucket = backendId.bucket;
    imageElement.backendName = backendId.name;

    // Create a fake state.
    const state: RootState = fakeState();
    // Make it look like the image is not loaded.
    const imageEntity = fakeImageEntity(undefined, false);
    const imageId = faker.datatype.uuid();
    state.imageView.ids = [imageId];
    state.imageView.entities[imageId] = imageEntity;

    // Set up the frontend ID.
    createImageEntityId.mockReturnValue(imageId);

    // Act.
    const updates = imageElement.mapState(state);

    // Assert.
    // It should have set the frontend ID.
    expect(updates).toEqual({ frontendId: imageId });
  });

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

  each([
    ["image is registered", { frontendId: faker.datatype.uuid() }],
    ["image is not registered", { backendId: fakeObjectRef() }],
  ]).it(
    "maps the correct actions to the image changed event when the %s",
    (_: string, imageId: ImageIdentifier) => {
      // Act.
      const eventMap = imageElement.mapEvents();

      // Assert.
      // It should have a mapping for the proper events.
      expect(eventMap).toHaveProperty(
        ConnectedLargeImageDisplay.IMAGE_CHANGED_EVENT_NAME
      );

      // This should fire the appropriate action creator.
      const testEvent = { detail: imageId };
      eventMap[ConnectedLargeImageDisplay.IMAGE_CHANGED_EVENT_NAME](
        testEvent as unknown as Event
      );

      // Check image changed event.
      if (imageId.frontendId) {
        // Image is registered.
        expect(thunkLoadImage).toBeCalledTimes(1);
        expect(thunkLoadImage).toBeCalledWith(testEvent.detail.frontendId);
      } else {
        // Image is not registered.
        expect(addArtifact).toBeCalledTimes(1);
        expect(addArtifact).toBeCalledWith(testEvent.detail.backendId);
      }
    }
  );

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
