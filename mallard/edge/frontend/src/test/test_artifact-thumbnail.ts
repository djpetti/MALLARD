import { ConnectedArtifactThumbnail } from "../artifact-thumbnail";
import {
  fakeArtifactEntity,
  fakeImageMetadata,
  fakeState,
  fakeVideoMetadata,
  getShadowRoot,
} from "./element-test-utils";
import {
  createArtifactEntityId,
  thunkSelectImages,
} from "../thumbnail-grid-slice";
import each from "jest-each";
import store, { RootState } from "../store";
import { faker } from "@faker-js/faker";
import { ObjectType } from "mallard-api";
import { MdIconButton } from "@material/web/all";

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

jest.mock("../connected-element", () => ({
  // Turn connect() into a pass-through.
  connectRedux: jest.fn((_, elementClass) => elementClass),
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
const mockLoadPage = jest.fn();

jest.mock("../page-manager", () => ({
  PageManager: {
    getInstance: jest.fn(() => ({ loadPage: mockLoadPage })),
  },
}));

/**
 * Creates pointer input even in jsdom versions without PointerEvent.
 * @param {string} type The event type.
 * @param {Partial<PointerEvent>} properties Overrides for the default touch.
 * @return {Event} A bubbling pointer-like event.
 */
function touchPointer(
  type: string,
  properties: Partial<PointerEvent> = {}
): Event {
  return Object.assign(new Event(type, { bubbles: true, composed: true }), {
    pointerId: 1,
    pointerType: "touch",
    isPrimary: true,
    clientX: 100,
    clientY: 100,
    ...properties,
  });
}

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

  it("mutes video previews", async () => {
    // Arrange.
    // Make it look like it's a video.
    thumbnailElement.type = ObjectType.VIDEO;
    thumbnailElement.metadata = fakeVideoMetadata();
    thumbnailElement.previewUrl = faker.internet.url();

    // Act.
    await thumbnailElement.updateComplete;

    // Assert.
    // It should have muted the video.
    const root = getShadowRoot(ConnectedArtifactThumbnail.tagName);
    const media = root.querySelector("#media") as HTMLVideoElement | null;
    expect(media?.muted).toBeTruthy();
  });

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
      const selectButton = root.querySelector("#select_button") as MdIconButton;
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
    ["select the image", true, false, ObjectType.IMAGE],
    ["de-select the image", false, false, ObjectType.IMAGE],
    ["select the video", true, false, ObjectType.VIDEO],
    ["de-select the video", false, false, ObjectType.VIDEO],
    ["shift-select the image", true, true, ObjectType.IMAGE],
    ["shift-de-select the image", false, true, ObjectType.IMAGE],
    ["shift-select the video", true, true, ObjectType.VIDEO],
    ["shift-de-select the video", false, true, ObjectType.VIDEO],
  ]).it(
    "allows the user to %s",
    async (
      _,
      select: boolean,
      shiftSelect: boolean,
      objectType: ObjectType
    ) => {
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

      // Add a handlers for the selected events.
      const selectEventHandler = jest.fn();
      thumbnailElement.addEventListener(
        ConnectedArtifactThumbnail.SELECTED_EVENT_NAME,
        selectEventHandler
      );
      const shiftSelectEventHandler = jest.fn();
      thumbnailElement.addEventListener(
        ConnectedArtifactThumbnail.SHIFT_SELECTED_EVENT_NAME,
        shiftSelectEventHandler
      );

      // Simulate a mouseover to show the select button.
      thumbnailElement.dispatchEvent(new MouseEvent("mouseenter"));
      await thumbnailElement.updateComplete;

      // Act.
      // Find the select button.
      const root = getShadowRoot(ConnectedArtifactThumbnail.tagName);
      const selectButton = root.querySelector("#select_button") as MdIconButton;

      // Simulate a click.
      selectButton.dispatchEvent(
        new MouseEvent("click", { shiftKey: shiftSelect })
      );

      await thumbnailElement.updateComplete;

      // Assert.
      // The state should be updated.
      expect(thumbnailElement.selected).toEqual(select);
      // It should be displaying correctly.
      expect(selectButton.selected).toEqual(select);

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
      if (select && shiftSelect) {
        expect(shiftSelectEventHandler).toBeCalledTimes(1);
        expect(selectEventHandler).not.toBeCalled();
      } else {
        expect(selectEventHandler).toBeCalledTimes(1);
        expect(shiftSelectEventHandler).not.toBeCalled();
      }
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
    const selectButton = root.querySelector("#select_button") as MdIconButton;
    expect(selectButton).not.toBeNull();
  });

  it("reveals unselected thumbnail buttons while selection mode is active", async () => {
    await thumbnailElement.updateComplete;
    thumbnailElement.selectionMode = true;
    await thumbnailElement.updateComplete;

    const root = getShadowRoot(ConnectedArtifactThumbnail.tagName);
    const button = root.querySelector("#select_button") as MdIconButton;
    expect(button).not.toBeNull();
    expect(button.selected).toBe(false);

    // Leaving the thumbnail must not hide the control during selection mode.
    thumbnailElement.dispatchEvent(new MouseEvent("mouseleave"));
    await thumbnailElement.updateComplete;
    expect(root.querySelector("#select_button")).not.toBeNull();

    thumbnailElement.selectionMode = false;
    await thumbnailElement.updateComplete;
    expect(root.querySelector("#select_button")).toBeNull();
  });

  it("does not reveal selection controls for unloaded thumbnails in selection mode", async () => {
    thumbnailElement.sourceUrl = undefined;
    thumbnailElement.selectionMode = true;
    await thumbnailElement.updateComplete;

    const root = getShadowRoot(ConnectedArtifactThumbnail.tagName);
    expect(root.querySelector("#select_button")).toBeNull();
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

  describe("selection-mode clicks", () => {
    beforeEach(async () => {
      mockLoadPage.mockClear();
      thumbnailElement.onClickLink = faker.internet.url();
      thumbnailElement.selectionMode = true;
      await thumbnailElement.updateComplete;
    });

    each([
      ["mouse", ObjectType.IMAGE, false],
      ["mouse", ObjectType.IMAGE, true],
      ["mouse", ObjectType.VIDEO, false],
      ["mouse", ObjectType.VIDEO, true],
      ["touch", ObjectType.IMAGE, false],
      ["touch", ObjectType.IMAGE, true],
      ["touch", ObjectType.VIDEO, false],
      ["touch", ObjectType.VIDEO, true],
    ]).it(
      "toggles selection instead of navigating (%s, %s, selected=%s)",
      async (
        pointerType: string,
        objectType: ObjectType,
        selected: boolean
      ) => {
        thumbnailElement.type = objectType;
        thumbnailElement.metadata = fakeVideoMetadata();
        thumbnailElement.selected = selected;
        await thumbnailElement.updateComplete;
        const onSelected = jest.fn();
        thumbnailElement.addEventListener(
          ConnectedArtifactThumbnail.SELECTED_EVENT_NAME,
          onSelected
        );
        const media = thumbnailElement.shadowRoot?.querySelector(
          "#media"
        ) as HTMLElement;

        media.dispatchEvent(touchPointer("pointerdown", { pointerType }));
        media.dispatchEvent(touchPointer("pointerup", { pointerType }));
        media.click();
        await thumbnailElement.updateComplete;

        expect(thumbnailElement.selected).toBe(!selected);
        expect(onSelected).toHaveBeenCalledTimes(1);
        expect(onSelected.mock.calls[0][0].detail).toBe(!selected);
        expect(mockLoadPage).not.toHaveBeenCalled();
      }
    );

    it("preserves Shift-click range selection on thumbnail content", () => {
      const onShiftSelected = jest.fn();
      thumbnailElement.addEventListener(
        ConnectedArtifactThumbnail.SHIFT_SELECTED_EVENT_NAME,
        onShiftSelected
      );
      thumbnailElement.dispatchEvent(
        new MouseEvent("click", { shiftKey: true })
      );

      expect(thumbnailElement.selected).toBe(true);
      expect(onShiftSelected).toHaveBeenCalledTimes(1);
      expect(mockLoadPage).not.toHaveBeenCalled();
    });

    it("does not toggle twice when the selection button is clicked", () => {
      const onSelected = jest.fn();
      thumbnailElement.addEventListener(
        ConnectedArtifactThumbnail.SELECTED_EVENT_NAME,
        onSelected
      );
      const button = thumbnailElement.shadowRoot?.querySelector(
        "#select_button"
      ) as MdIconButton;
      button.click();

      expect(thumbnailElement.selected).toBe(true);
      expect(onSelected).toHaveBeenCalledTimes(1);
      expect(mockLoadPage).not.toHaveBeenCalled();
    });

    it("does not navigate when deselecting the last item exits selection mode", async () => {
      thumbnailElement.selected = true;
      await thumbnailElement.updateComplete;
      thumbnailElement.addEventListener(
        ConnectedArtifactThumbnail.SELECTED_EVENT_NAME,
        () => {
          thumbnailElement.selectionMode = false;
        }
      );
      thumbnailElement.click();

      expect(thumbnailElement.selected).toBe(false);
      expect(thumbnailElement.selectionMode).toBe(false);
      expect(mockLoadPage).not.toHaveBeenCalled();

      // Only a subsequent click outside selection mode may open the details page.
      thumbnailElement.click();
      expect(mockLoadPage).toHaveBeenCalledWith(thumbnailElement.onClickLink);
    });

    it("does not select unloaded content or open details in selection mode", async () => {
      thumbnailElement.sourceUrl = undefined;
      await thumbnailElement.updateComplete;
      thumbnailElement.click();

      expect(thumbnailElement.selected).toBe(false);
      expect(mockLoadPage).not.toHaveBeenCalled();
    });

    it("toggles only once when a completed touch hold is followed by a click", async () => {
      jest.useFakeTimers();
      try {
        const onSelected = jest.fn();
        thumbnailElement.addEventListener(
          ConnectedArtifactThumbnail.SELECTED_EVENT_NAME,
          onSelected
        );
        thumbnailElement.dispatchEvent(touchPointer("pointerdown"));
        jest.advanceTimersByTime(1000);
        thumbnailElement.dispatchEvent(touchPointer("pointerup"));
        thumbnailElement.click();
        await thumbnailElement.updateComplete;

        expect(thumbnailElement.selected).toBe(true);
        expect(onSelected).toHaveBeenCalledTimes(1);
        expect(mockLoadPage).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe("touch selection", () => {
    beforeEach(async () => {
      jest.useFakeTimers();
      mockLoadPage.mockClear();
      thumbnailElement.onClickLink = faker.internet.url();
      await thumbnailElement.updateComplete;
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    each([ObjectType.IMAGE, ObjectType.VIDEO]).it(
      "selects a %s after exactly one second with hold feedback",
      async (objectType: ObjectType) => {
        thumbnailElement.type = objectType;
        thumbnailElement.metadata = fakeVideoMetadata();
        await thumbnailElement.updateComplete;
        const onSelected = jest.fn();
        thumbnailElement.addEventListener(
          ConnectedArtifactThumbnail.SELECTED_EVENT_NAME,
          onSelected
        );

        thumbnailElement.dispatchEvent(touchPointer("pointerdown"));
        await thumbnailElement.updateComplete;
        expect(
          thumbnailElement.shadowRoot?.querySelector(".holding")
        ).not.toBeNull();
        jest.advanceTimersByTime(999);
        expect(thumbnailElement.selected).toBe(false);
        expect(onSelected).not.toHaveBeenCalled();

        jest.advanceTimersByTime(1);
        await thumbnailElement.updateComplete;
        expect(thumbnailElement.selected).toBe(true);
        expect(onSelected).toHaveBeenCalledTimes(1);
        expect(onSelected.mock.calls[0][0].detail).toBe(true);
        expect(
          thumbnailElement.shadowRoot?.querySelector(".holding")
        ).toBeNull();
        expect(
          thumbnailElement.shadowRoot?.querySelector("#select_button")
        ).not.toBeNull();

        thumbnailElement.dispatchEvent(touchPointer("pointerup"));
        const click = new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
        });
        thumbnailElement.dispatchEvent(click);
        expect(click.defaultPrevented).toBe(true);
        expect(mockLoadPage).not.toHaveBeenCalled();
        jest.advanceTimersByTime(2000);
        expect(onSelected).toHaveBeenCalledTimes(1);
      }
    );

    it("allows short taps to open details without selecting", async () => {
      thumbnailElement.dispatchEvent(touchPointer("pointerdown"));
      jest.advanceTimersByTime(500);
      window.dispatchEvent(touchPointer("pointerup"));
      thumbnailElement.click();
      jest.advanceTimersByTime(1000);
      await thumbnailElement.updateComplete;

      expect(thumbnailElement.selected).toBe(false);
      expect(mockLoadPage).toHaveBeenCalledWith(thumbnailElement.onClickLink);
      expect(thumbnailElement.shadowRoot?.querySelector(".holding")).toBeNull();
    });

    each(["pointerup", "pointercancel", "scroll", "blur"]).it(
      "cancels the hold on %s",
      async (eventType: string) => {
        thumbnailElement.dispatchEvent(touchPointer("pointerdown"));
        jest.advanceTimersByTime(500);
        window.dispatchEvent(touchPointer(eventType));
        jest.advanceTimersByTime(1000);
        await thumbnailElement.updateComplete;

        expect(thumbnailElement.selected).toBe(false);
        expect(
          thumbnailElement.shadowRoot?.querySelector(".holding")
        ).toBeNull();
      }
    );

    each([
      [105, 105, true],
      [111, 100, false],
    ]).it(
      "allows small finger jitter but cancels dragging (%s, %s)",
      async (clientX: number, clientY: number, selected: boolean) => {
        thumbnailElement.dispatchEvent(touchPointer("pointerdown"));
        window.dispatchEvent(touchPointer("pointermove", { clientX, clientY }));
        jest.advanceTimersByTime(1000);
        expect(thumbnailElement.selected).toBe(selected);
      }
    );

    it("cancels when another finger touches the screen", () => {
      thumbnailElement.dispatchEvent(touchPointer("pointerdown"));
      window.dispatchEvent(
        touchPointer("pointerdown", { pointerId: 2, isPrimary: false })
      );
      jest.advanceTimersByTime(1000);
      expect(thumbnailElement.selected).toBe(false);
    });

    each(["mouse", "pen"]).it("ignores %s holds", (pointerType: string) => {
      thumbnailElement.dispatchEvent(
        touchPointer("pointerdown", { pointerType })
      );
      jest.advanceTimersByTime(1000);
      expect(thumbnailElement.selected).toBe(false);
    });

    it("ignores unloaded thumbnails", async () => {
      thumbnailElement.sourceUrl = undefined;
      await thumbnailElement.updateComplete;
      thumbnailElement.dispatchEvent(touchPointer("pointerdown"));
      jest.advanceTimersByTime(1000);
      expect(thumbnailElement.selected).toBe(false);
    });

    it("keeps the visible selection button independent of hold selection", async () => {
      thumbnailElement.selected = true;
      await thumbnailElement.updateComplete;
      const button = thumbnailElement.shadowRoot?.querySelector(
        "#select_button"
      ) as MdIconButton;
      button.dispatchEvent(touchPointer("pointerdown"));
      jest.advanceTimersByTime(1000);
      expect(thumbnailElement.selected).toBe(true);
      button.click();
      expect(thumbnailElement.selected).toBe(false);
      expect(mockLoadPage).not.toHaveBeenCalled();
    });

    it("can deselect with a second hold and still navigate on a later tap", async () => {
      thumbnailElement.selected = true;
      await thumbnailElement.updateComplete;
      thumbnailElement.dispatchEvent(touchPointer("pointerdown"));
      jest.advanceTimersByTime(1000);
      expect(thumbnailElement.selected).toBe(false);

      // A new gesture must clear suppression even if the browser sent no click.
      thumbnailElement.dispatchEvent(touchPointer("pointerdown"));
      thumbnailElement.dispatchEvent(touchPointer("pointerup"));
      thumbnailElement.click();
      expect(mockLoadPage).toHaveBeenCalledTimes(1);
    });

    each(["unload", "disconnect"]).it(
      "cancels pending holds on %s",
      async (reason: string) => {
        thumbnailElement.dispatchEvent(touchPointer("pointerdown"));
        if (reason === "unload") {
          thumbnailElement.sourceUrl = undefined;
          await thumbnailElement.updateComplete;
        } else {
          thumbnailElement.remove();
          // Reconnecting must not revive the old gesture.
          document.body.appendChild(thumbnailElement);
        }
        jest.advanceTimersByTime(1000);
        expect(thumbnailElement.selected).toBe(false);
      }
    );

    it("suppresses native context menus only for touch holds", () => {
      const mouseMenu = new MouseEvent("contextmenu", { cancelable: true });
      thumbnailElement.dispatchEvent(mouseMenu);
      expect(mouseMenu.defaultPrevented).toBe(false);

      thumbnailElement.dispatchEvent(touchPointer("pointerdown"));
      const touchMenu = new MouseEvent("contextmenu", { cancelable: true });
      thumbnailElement.dispatchEvent(touchMenu);
      expect(touchMenu.defaultPrevented).toBe(true);
    });
  });

  describe("mapState", () => {
    it("reveals an unselected thumbnail's button when other artifacts are selected", async () => {
      const state = fakeState();
      const image = fakeArtifactEntity(true);
      image.isSelected = false;
      const frontendId = createArtifactEntityId(image.backendId.id);
      state.imageView.ids = [frontendId];
      state.imageView.entities[frontendId] = image;
      mockGetState.mockReturnValue(state);
      thumbnailElement.frontendId = frontendId;
      await thumbnailElement.updateComplete;
      const root = getShadowRoot(ConnectedArtifactThumbnail.tagName);
      expect(root.querySelector("#select_button")).toBeNull();

      // The global count, rather than this artifact's selection, drives visibility.
      state.imageView.numItemsSelected = 1;
      thumbnailElement.stateChanged(state);
      await thumbnailElement.updateComplete;
      expect(thumbnailElement.selectionMode).toBe(true);
      expect(thumbnailElement.selected).toBe(false);
      expect(root.querySelector("#select_button")).not.toBeNull();

      state.imageView.numItemsSelected = 0;
      thumbnailElement.stateChanged(state);
      await thumbnailElement.updateComplete;
      expect(thumbnailElement.selectionMode).toBe(false);
      expect(root.querySelector("#select_button")).toBeNull();
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
      thumbnailElement.stateChanged(state);

      // Assert.
      // It should have updated the image URL.
      expect(thumbnailElement.sourceUrl).toEqual(
        state.imageView.entities[imageId]?.thumbnailUrl
      );

      // It should have set the selection status.
      expect(thumbnailElement.selected).toEqual(imageEntity.isSelected);

      // It should have set a link to the image details.
      expect(thumbnailElement.onClickLink).toContain(
        imageEntity.backendId.id.bucket
      );
      expect(thumbnailElement.onClickLink).toContain(
        imageEntity.backendId.id.name
      );

      // It should have set the preview URL.
      expect(thumbnailElement.previewUrl).toEqual(
        imageEntity.previewUrl ?? undefined
      );

      // It should have the metadata parameters.
      expect(thumbnailElement.metadata).toEqual(imageEntity.metadata);
      expect(thumbnailElement.type).toEqual(imageEntity.backendId.type);
    });

    it("ignores Redux updates when no image ID is set", () => {
      // Arrange.
      thumbnailElement.frontendId = undefined;

      // Act.
      thumbnailElement.stateChanged(fakeState());

      // Assert.
      expect(thumbnailElement.sourceUrl).toBeUndefined();
      expect(thumbnailElement.selected).toEqual(false);
      expect(thumbnailElement.onClickLink).toBeUndefined();
      expect(thumbnailElement.previewUrl).toBeUndefined();
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
      thumbnailElement.stateChanged(state);

      // Assert.
      expect(thumbnailElement.sourceUrl).toBeUndefined();
      expect(thumbnailElement.selected).toEqual(false);
      expect(thumbnailElement.onClickLink).toBeUndefined();
      expect(thumbnailElement.previewUrl).toBeUndefined();
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
      thumbnailElement.stateChanged(state);

      // Assert.
      expect(thumbnailElement.sourceUrl).toBeUndefined();
      expect(thumbnailElement.selected).toEqual(false);
      expect(thumbnailElement.onClickLink).toBeUndefined();
      expect(thumbnailElement.previewUrl).toBeUndefined();
    });
  });
});
