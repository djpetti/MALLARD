import { ConnectedArtifactThumbnail } from "../artifact-thumbnail";
import {
  fakeArtifactEntity,
  fakeImageMetadata,
  fakeState,
  fakeVideoMetadata,
  getShadowRoot,
} from "./element-test-utils";
import { RootState } from "../types";
import { IconButton } from "@material/mwc-icon-button";
import {
  createArtifactEntityId,
  thunkSelectImages,
} from "../thumbnail-grid-slice";
import each from "jest-each";
import store from "../store";
import { faker } from "@faker-js/faker";
import { ObjectType } from "mallard-api";

jest.mock("../thumbnail-grid-slice", () => {
  const actualSlice = jest.requireActual("../thumbnail-grid-slice");
  return {
    thunkSelectImages: jest.fn(),
    // Use the actual implementation for these functions.
    createArtifactEntityId: actualSlice.createArtifactEntityId,
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
    thumbnailElement.sourceUrl = faker.image.imageUrl();
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

  each([
    ["00:10", 300, 30],
    ["01:05", 30 * 65, 30],
    ["1:20:15", 30 * 3600 + 20 * 30 * 60 + 15 * 30, 30],
  ]).it(
    "renders video-specific indicators (%s)",
    async (durationFormat: string, numFrames: number, frameRate: number) => {
      // Arrange.
      // Make it look like it's a video.
      thumbnailElement.type = ObjectType.VIDEO;
      // Set the duration.
      thumbnailElement.metadata = fakeVideoMetadata();
      thumbnailElement.metadata.numFrames = numFrames;
      thumbnailElement.metadata.frameRate = frameRate;

      // Act.
      await thumbnailElement.updateComplete;

      // Assert.
      // It should show the video overlay.
      const root = getShadowRoot(ConnectedArtifactThumbnail.tagName);
      const videoMarker = root.querySelector(
        ".video_marker"
      ) as HTMLSpanElement;
      expect(videoMarker).not.toBeNull();

      // It should have a valid duration.
      expect(videoMarker.textContent).toContain(durationFormat);
    }
  );

  each([
    ["images", ObjectType.IMAGE],
    ["videos", ObjectType.VIDEO],
  ]).it(
    "handles mouseenter events for %s",
    async (_: string, objectType: ObjectType) => {
      // Arrange.
      thumbnailElement.type = objectType;
      thumbnailElement.metadata = fakeVideoMetadata();
      thumbnailElement.previewUrl = faker.internet.url();

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

      const media = root.querySelector("#media");
      if (objectType === ObjectType.VIDEO) {
        // If we mouse over a video, it should start playing a preview.
        expect(media?.tagName).toEqual("VIDEO");
        expect((media as HTMLVideoElement).src).toContain(
          thumbnailElement.previewUrl
        );
      } else {
        expect(media?.tagName).toEqual("IMG");
      }
    }
  );

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
    ["select the image", true, ObjectType.IMAGE],
    ["de-select the image", false, ObjectType.IMAGE],
    ["select the video", true, ObjectType.VIDEO],
    ["de-select the video", false, ObjectType.VIDEO],
  ]).it(
    "allows the user to %s",
    async (_, select: boolean, objectType: ObjectType) => {
      // Arrange.
      thumbnailElement.type = objectType;
      if (objectType === ObjectType.IMAGE) {
        // Make it look like it's an image.
        thumbnailElement.metadata = fakeImageMetadata();
      } else if (objectType === ObjectType.VIDEO) {
        // Make it look like it's a video.
        thumbnailElement.metadata = fakeVideoMetadata();
      }

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

      const videoMarker = root.querySelector(
        ".video_marker"
      ) as HTMLSpanElement;
      if (objectType === ObjectType.VIDEO) {
        expect(videoMarker).not.toBeNull();
      } else {
        // Otherwise, it shouldn't display it.
        expect(videoMarker).toBeNull();
      }

      // It should have dispatched the selected event.
      expect(selectEventHandler).toBeCalledTimes(1);
    }
  );

  it("hides the video marker when selected", async () => {
    // Arrange.
    thumbnailElement.selected = true;
    thumbnailElement.type = ObjectType.VIDEO;
    thumbnailElement.metadata = fakeVideoMetadata();

    // Act.
    await thumbnailElement.updateComplete;

    // Assert.
    const root = getShadowRoot(ConnectedArtifactThumbnail.tagName);
    const videoMarker = root.querySelector(".video_marker") as HTMLSpanElement;
    expect(videoMarker.classList).toContainEqual("marker_hidden");
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
    thumbnailElement.sourceUrl = undefined;

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
    const image = fakeArtifactEntity(true);
    const frontendId = createArtifactEntityId(image.backendId.id);
    state.imageView.ids = [frontendId];
    state.imageView.entities[frontendId] = image;

    mockGetState.mockReturnValue(state);

    // Act.
    // Reset the frontend ID.
    thumbnailElement.frontendId = frontendId;
    await thumbnailElement.updateComplete;

    // Assert.
    // It should have updated from the state.
    expect(thumbnailElement.sourceUrl).toEqual(image.thumbnailUrl);
    expect(thumbnailElement.selected).toEqual(image.isSelected);
    expect(thumbnailElement.onClickLink).not.toBeUndefined();
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
      const imageEntity = fakeArtifactEntity(true);
      state.imageView.ids = [imageId];
      state.imageView.entities[imageId] = imageEntity;

      // Act.
      const updates = thumbnailElement.mapState(state);

      // Assert.
      // It should have updated the image URL.
      expect(updates).toHaveProperty("sourceUrl");
      expect(updates["sourceUrl"]).toEqual(
        state.imageView.entities[imageId]?.thumbnailUrl
      );

      // It should have set the selection status.
      expect(updates).toHaveProperty("selected");
      expect(updates["selected"]).toEqual(imageEntity.isSelected);

      // It should have set a link to the image details.
      expect(updates).toHaveProperty("onClickLink");
      expect(updates["onClickLink"]).toContain(imageEntity.backendId.id.bucket);
      expect(updates["onClickLink"]).toContain(imageEntity.backendId.id.name);

      // It should have set the preview URL.
      expect(updates).toHaveProperty("previewUrl");
      expect(updates["previewUrl"]).toEqual(
        imageEntity.previewUrl ?? undefined
      );

      // It should have the metadata parameters.
      expect(updates).toHaveProperty("metadata");
      expect(updates["metadata"]).toEqual(imageEntity.metadata);
      expect(updates).toHaveProperty("type");
      expect(updates["type"]).toEqual(imageEntity.backendId.type);
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
      state.imageView.entities[imageId] = fakeArtifactEntity(false);

      // Act.
      const updates = thumbnailElement.mapState(state);

      // Assert.
      expect(updates).toEqual(DEFAULT_UPDATES);
    });
  });
});
