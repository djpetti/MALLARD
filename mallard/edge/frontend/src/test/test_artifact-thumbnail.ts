import { ConnectedArtifactThumbnail } from "../artifact-thumbnail";
import {
  fakeState,
  fakeThumbnailEntity,
  getShadowRoot,
} from "./element-test-utils";
import { RootState } from "../types";

// I know this sounds insane, but when I import this as an ES6 module, faker.seed() comes up
// undefined. I can only assume this is a quirk in Babel.
const faker = require("faker");

// Using older require syntax here so we get the correct mock type.
const thumbnailGridSlice = require("../thumbnail-grid-slice");
const mockThunkLoadThumbnail = thumbnailGridSlice.thunkLoadThumbnail;
const mockThumbnailGridSelectors = thumbnailGridSlice.thumbnailGridSelectors;
const { thumbnailGridSelectors } = jest.requireActual(
  "../thumbnail-grid-slice"
);

jest.mock("@captaincodeman/redux-connect-element", () => ({
  // Turn connect() into a pass-through.
  connect: jest.fn((_, elementClass) => elementClass),
}));
jest.mock("../thumbnail-grid-slice", () => ({
  thunkLoadThumbnail: jest.fn(),
  thumbnailGridSelectors: { selectById: jest.fn() },
}));
jest.mock("../store", () => ({
  // Mock this to avoid an annoying spurious console error from Redux.
  configureStore: jest.fn(),
}));

describe("artifact-thumbnail", () => {
  /** Internal artifact-thumbnail to use for testing. */
  let thumbnailElement: ConnectedArtifactThumbnail;

  beforeAll(() => {
    // Manually register the custom element.
    customElements.define(
      ConnectedArtifactThumbnail.tagName,
      ConnectedArtifactThumbnail
    );
  });

  beforeEach(() => {
    // Set a faker seed.
    faker.seed(1337);

    // Use the actual implementation for this function.
    mockThumbnailGridSelectors.selectById.mockImplementation(
      thumbnailGridSelectors.selectById
    );

    thumbnailElement = window.document.createElement(
      ConnectedArtifactThumbnail.tagName
    ) as ConnectedArtifactThumbnail;
    document.body.appendChild(thumbnailElement);
  });

  afterEach(() => {
    document.body
      .getElementsByTagName(ConnectedArtifactThumbnail.tagName)[0]
      .remove();
  });

  it("can be instantiated", () => {
    // Assert.
    expect(thumbnailElement.imageId).toEqual(null);
  });

  it("displays no image by default", async () => {
    // Act.
    await thumbnailElement.updateComplete;

    // Assert.
    const thumbnailDiv = getShadowRoot(
      ConnectedArtifactThumbnail.tagName
    ).querySelector("#image_container") as HTMLElement;
    // There should be no image element displayed.
    expect(thumbnailDiv.getElementsByTagName("img").length).toEqual(0);

    // It should report that no image is specified.
    expect(thumbnailElement.hasImage).toBe(false);
  });

  it("displays an image when we set the URL", async () => {
    // Arrange.
    const fakeImageUrl = faker.image.imageUrl();

    // Act.
    // Set the URL.
    thumbnailElement.imageUrl = fakeImageUrl;
    await thumbnailElement.updateComplete;

    // Assert.
    // It should have rendered the image.
    const thumbnailDiv = getShadowRoot(
      ConnectedArtifactThumbnail.tagName
    ).querySelector("#image_container") as HTMLElement;

    const images = thumbnailDiv.getElementsByTagName("img");
    expect(images.length).toEqual(1);

    // It should have set the correct image source.
    expect(images[0].src).toEqual(fakeImageUrl);
  });

  it("fires an event when we set the image ID", async () => {
    // Arrange.
    // Fake image ID to use for testing.
    const fakeImageId: string = "test-image-id";

    // Setup a fake handler for our event.
    const handler = jest.fn();
    thumbnailElement.addEventListener("image-changed", handler);

    // Act.
    thumbnailElement.imageId = fakeImageId;
    await thumbnailElement.updateComplete;

    // Assert.
    // It should have caught the event.
    expect(handler).toBeCalledTimes(1);
  });

  it("maps the correct actions to events", () => {
    // Act.
    const eventMap = thumbnailElement.mapEvents();

    // Assert.
    // It should have a mapping for the proper events.
    expect(eventMap).toHaveProperty("image-changed");

    // This should fire the appropriate action creator.
    const testEvent = { detail: faker.datatype.uuid() };
    eventMap["image-changed"](testEvent as unknown as Event);

    expect(mockThunkLoadThumbnail).toBeCalledTimes(1);
    expect(mockThunkLoadThumbnail).toBeCalledWith(testEvent.detail);
  });

  it("updates the properties from the Redux state", () => {
    // Arrange.
    // Set a thumbnail image ID.
    const imageId = faker.datatype.uuid();
    thumbnailElement.imageId = imageId;

    // Create a fake state.
    const state: RootState = fakeState();
    state.thumbnailGrid.ids = [imageId];
    state.thumbnailGrid.entities[imageId] = fakeThumbnailEntity(true);

    // Act.
    const updates = thumbnailElement.mapState(state);

    // Assert.
    // It should have gotten the correct updates.
    expect(updates).toHaveProperty("imageUrl");
    expect(updates["imageUrl"]).toEqual(
      state.thumbnailGrid.entities[imageId]?.imageUrl
    );
  });

  it("ignores Redux updates when no image ID is set", () => {
    // Arrange.
    thumbnailElement.imageId = null;

    // Act.
    const updates = thumbnailElement.mapState(fakeState());

    // Assert.
    expect(updates).toEqual({});
  });

  it("ignores Redux updates when the image has not been loaded", () => {
    // Arrange.
    // Set a thumbnail image ID.
    const imageId = faker.datatype.uuid();
    thumbnailElement.imageId = imageId;

    // Create a fake state.
    const state: RootState = fakeState();
    state.thumbnailGrid.ids = [imageId];
    state.thumbnailGrid.entities[imageId] = fakeThumbnailEntity(false);

    // Act.
    const updates = thumbnailElement.mapState(state);

    // Assert.
    expect(updates).toEqual({});
  });
});
