import { ConnectedThumbnailGridSection } from "../thumbnail-grid-section";
import {
  fakeImageEntity,
  fakeState,
  getShadowRoot,
} from "./element-test-utils";
import { ArtifactThumbnail } from "../artifact-thumbnail";
import each from "jest-each";
import { IconButton } from "@material/mwc-icon-button";
import { createImageEntityId, selectImages } from "../thumbnail-grid-slice";

// I know this sounds insane, but when I import this as an ES6 module, faker.seed() comes up
// undefined. I can only assume this is a quirk in Babel.
const faker = require("faker");

jest.mock("@captaincodeman/redux-connect-element", () => ({
  // Turn connect() into a pass-through.
  connect: jest.fn((_, elementClass) => elementClass),
}));
jest.mock("../store", () => ({
  // Mock this to avoid an annoying spurious console error from Redux.
  configureStore: jest.fn(),
}));

jest.mock("../thumbnail-grid-slice", () => {
  const actualSlice = jest.requireActual("../thumbnail-grid-slice");
  return {
    selectImages: jest.fn(),

    // Use the actual implementation for these functions.
    thumbnailGridSelectors: {
      selectById: actualSlice.thumbnailGridSelectors.selectById,
    },
    createImageEntityId: actualSlice.createImageEntityId,
  };
});
const mockSelectImages = selectImages as jest.MockedFn<typeof selectImages>;

describe("thumbnail-grid-section", () => {
  /** Internal thumbnail-grid-section to use for testing. */
  let gridSectionElement: ConnectedThumbnailGridSection;

  beforeAll(() => {
    // Manually register the custom element.
    customElements.define(
      ConnectedThumbnailGridSection.tagName,
      ConnectedThumbnailGridSection
    );
  });

  beforeEach(() => {
    gridSectionElement = window.document.createElement(
      ConnectedThumbnailGridSection.tagName
    ) as ConnectedThumbnailGridSection;
    document.body.appendChild(gridSectionElement);
  });

  afterEach(() => {
    document.body
      .getElementsByTagName(ConnectedThumbnailGridSection.tagName)[0]
      .remove();
  });

  it("correctly renders when empty", () => {
    // Assert.
    // It should have no thumbnails displayed.
    expect(gridSectionElement.displayedArtifacts.length).toEqual(0);

    // It should not have rendered the section header.
    const root = getShadowRoot(ConnectedThumbnailGridSection.tagName);
    expect(root.querySelectorAll(".section_divider").length).toEqual(0);
  });

  it("correctly renders when not empty", async () => {
    // Arrange.
    // Add a few thumbnails.
    gridSectionElement.displayedArtifacts = ["steven", "bob"];
    // Set a header.
    gridSectionElement.sectionHeader = "My Header";

    // Act.
    await gridSectionElement.updateComplete;

    // Assert.
    const root = getShadowRoot(ConnectedThumbnailGridSection.tagName);

    // It should have rendered the correct header.
    const divider = root.querySelector("#section_divider") as HTMLElement;
    expect(divider).not.toBe(null);
    expect(divider.textContent).toContain("My Header");

    // It should have rendered the correct thumbnails.
    const contents = root.querySelector("#section_contents") as HTMLElement;
    expect(contents).not.toBe(null);
    expect(contents.childElementCount).toBe(2);
    for (const thumbnail of contents.children) {
      expect(gridSectionElement.displayedArtifacts).toContain(
        (thumbnail as ArtifactThumbnail).frontendId
      );
    }
  });

  each([
    ["select", true],
    ["de-select", false],
  ]).it("allows the user to %s the section", async (_, select: boolean) => {
    // Arrange.
    // Initially set the state to the opposite of what we're changing it to.
    gridSectionElement.selected = !select;

    // Add some artifacts to force it to actually display.
    gridSectionElement.displayedArtifacts = [faker.datatype.uuid()];
    await gridSectionElement.updateComplete;

    // Add a handler for the selected event.
    const selectEventHandler = jest.fn();
    gridSectionElement.addEventListener(
      ConnectedThumbnailGridSection.SELECT_TOGGLED_EVENT_NAME,
      selectEventHandler
    );

    // Act.
    // Find the select button.
    const root = getShadowRoot(ConnectedThumbnailGridSection.tagName);
    const selectButton = root.querySelector("#select_button") as IconButton;

    // Simulate a click.
    selectButton.dispatchEvent(new MouseEvent("click"));

    await gridSectionElement.updateComplete;

    // Assert.
    // The state should be updated.
    expect(gridSectionElement.selected).toEqual(select);
    // It should be displaying correctly.
    expect(selectButton.icon).toEqual(
      select ? "check_circle" : "radio_button_unchecked"
    );

    // It should have dispatched the selected event.
    expect(selectEventHandler).toBeCalledTimes(1);
  });

  each([
    ["selected", true],
    ["not selected", false],
  ]).it(
    "updates the properties from the Redux state when all images are %s",
    (_, selectAll: boolean) => {
      // Arrange.
      // Add some artifacts.
      const image1 = fakeImageEntity();
      const image2 = fakeImageEntity();
      const image1Id = createImageEntityId(image1.backendId);
      const image2Id = createImageEntityId(image2.backendId);
      gridSectionElement.displayedArtifacts = [image1Id, image2Id];

      if (selectAll) {
        // Make it look like they're all selected.
        image1.isSelected = image2.isSelected = true;
      } else {
        // De-select at least one.
        image2.isSelected = false;
      }

      // Create the fake state.
      const state = fakeState();
      state.imageView.ids = [image1Id, image2Id];
      state.imageView.entities[image1Id] = image1;
      state.imageView.entities[image2Id] = image2;

      // Act.
      const gotUpdates = gridSectionElement.mapState(state);

      // Assert.
      // It should have updated the selection status appropriately.
      expect(gotUpdates).toHaveProperty("selected");
      expect(gotUpdates.selected).toEqual(selectAll);
    }
  );

  it(`maps the correct action to the ${ConnectedThumbnailGridSection.SELECT_TOGGLED_EVENT_NAME} event`, () => {
    // Arrange.
    // Add some fake displayed artifacts.
    gridSectionElement.displayedArtifacts = [
      faker.datatype.uuid(),
      faker.datatype.uuid(),
    ];

    // Act.
    const eventMap = gridSectionElement.mapEvents();

    // Assert.
    // It should have a mapping for the proper events.
    expect(eventMap).toHaveProperty(
      ConnectedThumbnailGridSection.SELECT_TOGGLED_EVENT_NAME
    );

    // This should fire the appropriate action creator.
    const selected = faker.datatype.boolean();
    eventMap[ConnectedThumbnailGridSection.SELECT_TOGGLED_EVENT_NAME](
      new CustomEvent<boolean>(
        ConnectedThumbnailGridSection.SELECT_TOGGLED_EVENT_NAME,
        { detail: selected }
      )
    );

    // It should fire the appropriate action creator.
    expect(mockSelectImages).toBeCalledWith({
      imageIds: gridSectionElement.displayedArtifacts,
      select: selected,
    });
  });
});
