import { ConnectedArtifactThumbnail } from "../artifact-thumbnail";
import {
  fakeImageEntity,
  fakeState,
  getShadowRoot,
} from "./element-test-utils";
import { RootState } from "../types";
import { IconButton } from "@material/mwc-icon-button";
import {
  createImageEntityId,
  thunkSelectImages,
} from "../thumbnail-grid-slice";
import each from "jest-each";
import store from "../store";
import { faker } from "@faker-js/faker";

jest.mock("../thumbnail-grid-slice", () => {
  const actualSlice = jest.requireActual("../thumbnail-grid-slice");
  return {
    thunkSelectImages: jest.fn(),
    // Use the actual implementation for these functions.
    createImageEntityId: actualSlice.createImageEntityId,
    thumbnailGridSelectors: {
      selectById: actualSlice.thumbnailGridSelectors.selectById,
    },
  };
});
const mockSelectImages = thunkSelectImages as jest.MockedFn<
  typeof thunkSelectImages
>;

jest.mock("@captaincodeman/redux-connect-element", () => ({
  // Turn connect() into a pass-through.
  connect: jest.fn((_, elementClass) => elementClass),
}));
jest.mock("../store", () => {
  return {
    // Mock this function to avoid spurious errors in the console.
    configureStore: jest.fn(),
    // By default, just return a blank state, so that at least selectors work.
    getState: jest.fn(() => fakeState()),
  };
});

const mockGetState = store.getState as jest.MockedFn<typeof store.getState>;

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

    thumbnailElement = window.document.createElement(
      ConnectedArtifactThumbnail.tagName
    ) as ConnectedArtifactThumbnail;
    document.body.appendChild(thumbnailElement);

    // Make it look like we have an image.
    thumbnailElement.imageUrl = faker.image.imageUrl();
  });

  afterEach(() => {
    document.body
      .getElementsByTagName(ConnectedArtifactThumbnail.tagName)[0]
      .remove();
  });

  it("renders correctly by default", async () => {
    // Act.
    await thumbnailElement.updateComplete;

    // Assert.
    expect(thumbnailElement.frontendId).toBeUndefined();

    // It should default to not showing the select button.
    const root = getShadowRoot(ConnectedArtifactThumbnail.tagName);
    expect(root.querySelector("#select_button")).toBeNull();
  });

  it("handles mouseenter events", async () => {
    // Arrange.
    // The event handlers will be added on the first update.
    await thumbnailElement.updateComplete;

    // Act.
    // Simulate a mouseenter event.
    thumbnailElement.dispatchEvent(new MouseEvent("mouseenter"));
    await thumbnailElement.updateComplete;

    // Assert.
    // It should be showing the selected button.
    const root = getShadowRoot(ConnectedArtifactThumbnail.tagName);
    const selectButton = root.querySelector("#select_button") as IconButton;
    expect(selectButton).not.toBeNull();
  });

  it("handles mouseleave events", async () => {
    // Arrange.
    // The event handlers will be added on the first update.
    await thumbnailElement.updateComplete;

    // Act.
    // Simulate a mouseenter event.
    thumbnailElement.dispatchEvent(new MouseEvent("mouseenter"));
    await thumbnailElement.updateComplete;

    // Simulate a mouseleave event.
    thumbnailElement.dispatchEvent(new MouseEvent("mouseleave"));
    await thumbnailElement.updateComplete;

    // Assert.
    // It should not be showing the select button.
    const root = getShadowRoot(ConnectedArtifactThumbnail.tagName);
    expect(root.querySelector("#select_button")).toBeNull();
  });

  each([
    ["select", true],
    ["de-select", false],
  ]).it("allows the user to %s the thumbnail", async (_, select: boolean) => {
    // Arrange.
    // Initially set the state to the opposite of what we're changing it to.
    thumbnailElement.selected = !select;
    // The event handlers will be added on the first update.
    await thumbnailElement.updateComplete;

    // Add a handler for the selected event.
    const selectEventHandler = jest.fn();
    thumbnailElement.addEventListener(
      ConnectedArtifactThumbnail.SELECTED_EVENT_NAME,
      selectEventHandler
    );

    // Simulate a mouseover to show the select button.
    thumbnailElement.dispatchEvent(new MouseEvent("mouseenter"));
    await thumbnailElement.updateComplete;

    // Act.
    // Find the select button.
    const root = getShadowRoot(ConnectedArtifactThumbnail.tagName);
    const selectButton = root.querySelector("#select_button") as IconButton;

    // Simulate a click.
    selectButton.dispatchEvent(new MouseEvent("click"));

    await thumbnailElement.updateComplete;

    // Assert.
    // The state should be updated.
    expect(thumbnailElement.selected).toEqual(select);
    // It should be displaying correctly.
    expect(selectButton.icon).toEqual(
      select ? "check_circle" : "radio_button_unchecked"
    );

    // It should have dispatched the selected event.
    expect(selectEventHandler).toBeCalledTimes(1);
  });

  it("permanently shows the select button when the thumbnail is selected", async () => {
    // Arrange.
    // Select it.
    thumbnailElement.selected = true;
    await thumbnailElement.updateComplete;

    // Act.
    // Simulate the user mousing away.
    thumbnailElement.dispatchEvent(new MouseEvent("mouseleave"));
    await thumbnailElement.updateComplete;

    // Assert.
    // It should still be showing the select button.
    const root = getShadowRoot(ConnectedArtifactThumbnail.tagName);
    const selectButton = root.querySelector("#select_button") as IconButton;
    expect(selectButton).not.toBeNull();
  });

  it("never shows the select button when we have no image", async () => {
    // Arrange.
    // Make it look like it has no image.
    thumbnailElement.imageUrl = undefined;

    // Act.
    // Simulate the user hovering.
    thumbnailElement.dispatchEvent(new MouseEvent("mouseenter"));
    await thumbnailElement.updateComplete;

    // Assert.
    // It should not be showing the select button.
    const root = getShadowRoot(ConnectedArtifactThumbnail.tagName);
    expect(root.querySelector("#select_button")).toBeNull();
  });

  it(`maps the correct action to the ${ConnectedArtifactThumbnail.SELECTED_EVENT_NAME} event`, () => {
    // Act.
    const eventMap = thumbnailElement.mapEvents();

    // Assert.
    // It should have a mapping for the proper events.
    expect(eventMap).toHaveProperty(
      ConnectedArtifactThumbnail.SELECTED_EVENT_NAME
    );

    // This should fire the appropriate action creator.
    const selected = faker.datatype.boolean();
    eventMap[ConnectedArtifactThumbnail.SELECTED_EVENT_NAME](
      new CustomEvent<boolean>(ConnectedArtifactThumbnail.SELECTED_EVENT_NAME, {
        detail: selected,
      })
    );

    // It should fire the appropriate action creator.
    expect(mockSelectImages).toBeCalledWith({
      imageIds: [thumbnailElement.frontendId],
      select: selected,
    });
  });

  it("updates from the Redux state when the frontend ID changes", async () => {
    // Arrange.
    // Make it look like we have a somewhat interesting state.
    const state = fakeState();
    const image = fakeImageEntity(true);
    const frontendId = createImageEntityId(image.backendId);
    state.imageView.ids = [frontendId];
    state.imageView.entities[frontendId] = image;

    mockGetState.mockReturnValue(state);

    // Act.
    // Reset the frontend ID.
    thumbnailElement.frontendId = frontendId;
    await thumbnailElement.updateComplete;

    // Assert.
    // It should have updated from the state.
    expect(thumbnailElement.imageUrl).toEqual(image.thumbnailUrl);
    expect(thumbnailElement.selected).toEqual(image.isSelected);
    expect(thumbnailElement.imageLink).not.toBeUndefined();
  });

  describe("mapState", () => {
    /**
     * Updates it will produce when the state is invalid.
     */
    const DEFAULT_UPDATES = {
      imageUrl: undefined,
      selected: false,
      imageLink: undefined,
    };

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

      // It should have set the selection status.
      expect(updates).toHaveProperty("selected");
      expect(updates["selected"]).toEqual(imageEntity.isSelected);

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
      expect(updates).toEqual(DEFAULT_UPDATES);
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
      expect(updates).toEqual(DEFAULT_UPDATES);
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
      expect(updates).toEqual(DEFAULT_UPDATES);
    });
  });
});
