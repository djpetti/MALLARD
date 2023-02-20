import { ConnectedArtifactThumbnail } from "../artifact-thumbnail";
import { fakeImageEntity, fakeState } from "./element-test-utils";
import { RootState } from "../types";

// I know this sounds insane, but when I import this as an ES6 module, faker.seed() comes up
// undefined. I can only assume this is a quirk in Babel.
const faker = require("faker");

// Using older require syntax here so that we get the correct mock type.
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
    expect(thumbnailElement.frontendId).toBeUndefined();
  });

  it("maps the correct actions to events", () => {
    // Act.
    const eventMap = thumbnailElement.mapEvents();

    // Assert.
    // It should have a mapping for the proper events.
    expect(eventMap).toHaveProperty(
      ConnectedArtifactThumbnail.IMAGE_CHANGED_EVENT_NAME
    );

    // This should fire the appropriate action creator.
    const testEvent = { detail: { frontendId: faker.datatype.uuid() } };
    eventMap[ConnectedArtifactThumbnail.IMAGE_CHANGED_EVENT_NAME](
      testEvent as unknown as Event
    );

    expect(mockThunkLoadThumbnail).toBeCalledTimes(1);
    expect(mockThunkLoadThumbnail).toBeCalledWith(testEvent.detail.frontendId);
  });

  it("updates the properties from the Redux state", () => {
    // Arrange.
    // Set a thumbnail image ID.
    const imageId = faker.datatype.uuid();
    thumbnailElement.frontendId = imageId;

    // Create a fake state.
    const state: RootState = fakeState();
    const imageEntity = fakeImageEntity(true);
    state.imageView.ids = [imageId];
    state.imageView.entities[imageId] = imageEntity;

    // Act.
    const updates = thumbnailElement.mapState(state);

    // Assert.
    // It should have updated the image URL.
    expect(updates).toHaveProperty("imageUrl");
    expect(updates["imageUrl"]).toEqual(
      state.imageView.entities[imageId]?.thumbnailUrl
    );

    // It should have set a link to the image details.
    expect(updates).toHaveProperty("imageLink");
    expect(updates["imageLink"]).toContain(imageEntity.backendId.bucket);
    expect(updates["imageLink"]).toContain(imageEntity.backendId.name);
  });

  it("ignores Redux updates when no image ID is set", () => {
    // Arrange.
    thumbnailElement.frontendId = undefined;

    // Act.
    const updates = thumbnailElement.mapState(fakeState());

    // Assert.
    expect(updates).toEqual({});
  });

  it("ignores Redux updates when the image ID is invalid", () => {
    // Arrange.
    // Set a thumbnail image ID.
    thumbnailElement.frontendId = faker.datatype.uuid();

    // Create a fake state.
    const state: RootState = fakeState();
    // Make it look like this image doesn't exist.
    state.imageView.ids = [];

    // Act.
    const updates = thumbnailElement.mapState(state);

    // Assert.
    expect(updates).toEqual({});
  });

  it("ignores Redux updates when the image has not been loaded", () => {
    // Arrange.
    // Set a thumbnail image ID.
    const imageId = faker.datatype.uuid();
    thumbnailElement.frontendId = imageId;

    // Create a fake state.
    const state: RootState = fakeState();
    state.imageView.ids = [imageId];
    state.imageView.entities[imageId] = fakeImageEntity(false);

    // Act.
    const updates = thumbnailElement.mapState(state);

    // Assert.
    expect(updates).toEqual({});
  });
});
