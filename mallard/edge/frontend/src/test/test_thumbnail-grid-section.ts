import { ConnectedThumbnailGridSection } from "../thumbnail-grid-section";
import {
  fakeImageEntity,
  fakeState,
  getShadowRoot,
} from "./element-test-utils";
import { ArtifactThumbnail } from "../artifact-thumbnail";
import each from "jest-each";
import { IconButton } from "@material/mwc-icon-button";
import {
  createImageEntityId,
  setSectionExpanded,
  thunkClearEntities,
  thunkLoadThumbnails,
  thunkSelectImages,
} from "../thumbnail-grid-slice";
import { faker } from "@faker-js/faker";
import { IconButtonToggle } from "@material/mwc-icon-button-toggle";

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
    thunkSelectImages: jest.fn(),
    setSectionExpanded: jest.fn(),
    thunkLoadThumbnails: jest.fn(),
    thunkClearEntities: jest.fn(),

    // Use the actual implementation for these functions.
    thumbnailGridSelectors: {
      selectById: actualSlice.thumbnailGridSelectors.selectById,
    },
    createImageEntityId: actualSlice.createImageEntityId,
  };
});
const mockSelectImages = thunkSelectImages as jest.MockedFn<
  typeof thunkSelectImages
>;
const mockSetSectionExpanded = setSectionExpanded as jest.MockedFn<
  typeof setSectionExpanded
>;
const mockThunkLoadThumbnails = thunkLoadThumbnails as jest.MockedFn<
  typeof thunkLoadThumbnails
>;
const mockThunkClearEntities = thunkClearEntities as jest.MockedFn<
  typeof thunkClearEntities
>;

describe("thumbnail-grid-section", () => {
  /** Internal thumbnail-grid-section to use for testing. */
  let gridSectionElement: ConnectedThumbnailGridSection;

  // Handler for the expand/collapse event.
  const expandEventHandler = jest.fn();

  // Add handlers for the clear and reload events.
  const clearEventHandler = jest.fn();
  const reloadEventHandler = jest.fn();

  beforeAll(() => {
    // Manually register the custom element.
    customElements.define(
      ConnectedThumbnailGridSection.tagName,
      ConnectedThumbnailGridSection
    );
  });

  beforeEach(() => {
    faker.seed(1337);

    jest.clearAllMocks();

    // Add the element under test.
    gridSectionElement = window.document.createElement(
      ConnectedThumbnailGridSection.tagName
    ) as ConnectedThumbnailGridSection;
    document.body.appendChild(gridSectionElement);

    // Set up event handlers.
    gridSectionElement.addEventListener(
      ConnectedThumbnailGridSection.EXPAND_TOGGLED_EVENT_NAME,
      expandEventHandler
    );
    gridSectionElement.addEventListener(
      ConnectedThumbnailGridSection.DELETE_DATA_EVENT_NAME,
      clearEventHandler
    );
    gridSectionElement.addEventListener(
      ConnectedThumbnailGridSection.RELOAD_DATA_EVENT_NAME,
      reloadEventHandler
    );
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
    gridSectionElement.displayedArtifacts = [
      faker.datatype.uuid(),
      faker.datatype.uuid(),
    ];
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

  it("correctly renders when the section is collapsed", async () => {
    // Arrange.
    // Add a few thumbnails.
    gridSectionElement.displayedArtifacts = [
      faker.datatype.uuid(),
      faker.datatype.uuid(),
    ];
    // Set it to be collapsed.
    gridSectionElement.expanded = false;

    // Act.
    await gridSectionElement.updateComplete;

    // Assert.
    const root = getShadowRoot(ConnectedThumbnailGridSection.tagName);

    // It should have rendered the correct header.
    const divider = root.querySelector("#section_divider") as HTMLElement;
    expect(divider).not.toBe(null);
    expect(divider.textContent).toContain("Section Header");

    // It should not have rendered the thumbnails.
    const contents = root.querySelector("#section_contents") as HTMLElement;
    expect(contents).toBe(null);
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

  it("can clear the thumbnails", () => {
    // Arrange.
    // Set some displayed artifacts.
    gridSectionElement.displayedArtifacts = [
      faker.datatype.uuid(),
      faker.datatype.uuid(),
    ];

    // Act.
    gridSectionElement.clearThumbnails();

    // Assert.
    // It should have dispatched the clear event.
    expect(clearEventHandler).toBeCalledTimes(1);
    // It should have cleared everything.
    expect(clearEventHandler.mock.calls[0][0].detail).toEqual(
      gridSectionElement.displayedArtifacts
    );
  });

  each([
    ["expanded", true],
    ["collapsed", false],
  ]).it("can reload the thumbnails when it is %s", (_, expanded: boolean) => {
    // Arrange.
    // Set some displayed artifacts.
    gridSectionElement.displayedArtifacts = [
      faker.datatype.uuid(),
      faker.datatype.uuid(),
    ];

    // Make it look like it is expanded or collapsed.
    gridSectionElement.expanded = expanded;

    // Act.
    gridSectionElement.reloadThumbnails();

    // Assert.
    if (expanded) {
      // It should have dispatched the reload event.
      expect(reloadEventHandler).toBeCalledTimes(1);
      // It should have reloaded everything.
      expect(reloadEventHandler.mock.calls[0][0].detail).toEqual(
        gridSectionElement.displayedArtifacts
      );
    } else {
      // It should not have reloaded, because the section is not expanded.
      expect(reloadEventHandler).not.toBeCalled();
    }
  });

  each([
    ["expand", true],
    ["collapse", false],
  ]).it("allows the user to %s the section", async (_, expand: boolean) => {
    // Arrange.
    // Initially set the state to the opposite of what we're changing it to.
    gridSectionElement.expanded = !expand;

    // Add some artifacts to force it to actually display.
    gridSectionElement.displayedArtifacts = [faker.datatype.uuid()];
    await gridSectionElement.updateComplete;

    // Act.
    // Find the expand/collapse button.
    const root = getShadowRoot(ConnectedThumbnailGridSection.tagName);
    const collapseButton = root.querySelector(
      "#collapse_button"
    ) as IconButtonToggle;

    // Simulate a click.
    collapseButton.dispatchEvent(new MouseEvent("click"));

    await gridSectionElement.updateComplete;

    // Assert.
    // The state should be updated.
    expect(gridSectionElement.expanded).toEqual(expand);
    // It should be displaying correctly.
    expect(collapseButton.on).toEqual(expand);

    // It should have dispatched the expand/collapse event.
    expect(expandEventHandler).toBeCalledTimes(1);

    // It should have cleared/reloaded the thumbnails.
    if (expand) {
      expect(reloadEventHandler).toBeCalledTimes(1);
    } else {
      expect(clearEventHandler).toBeCalledTimes(1);
    }
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

  each([
    ["expanded", true],
    ["collapsed", false],
  ]).it(
    "updates the properties from the Redux state when the section is %s",
    (_, expanded: boolean) => {
      // Arrange.
      const state = fakeState();
      if (!expanded) {
        // Make it look like it's collapsed.
        state.imageView.collapsedSections[gridSectionElement.sectionHeader] =
          true;
      }

      // Act.
      const gotUpdates = gridSectionElement.mapState(state);

      // Assert.
      // It should have updated the expanded property appropriately.
      expect(gotUpdates["expanded"]).toEqual(expanded);
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

  it(`maps the correct action to the ${ConnectedThumbnailGridSection.EXPAND_TOGGLED_EVENT_NAME} event`, () => {
    // Arrange.
    // Act.
    const eventMap = gridSectionElement.mapEvents();

    // Assert.
    // It should have a mapping for the proper events.
    expect(eventMap).toHaveProperty(
      ConnectedThumbnailGridSection.EXPAND_TOGGLED_EVENT_NAME
    );

    // This should fire the appropriate action creator.
    const expand = faker.datatype.boolean();
    eventMap[ConnectedThumbnailGridSection.EXPAND_TOGGLED_EVENT_NAME](
      new CustomEvent<boolean>(
        ConnectedThumbnailGridSection.EXPAND_TOGGLED_EVENT_NAME,
        { detail: expand }
      )
    );

    // It should fire the appropriate action creator.
    expect(mockSetSectionExpanded).toBeCalledWith({
      sectionName: gridSectionElement.sectionHeader,
      expand: expand,
    });
  });

  it(`maps the correct actions to the ${ConnectedThumbnailGridSection.RELOAD_DATA_EVENT_NAME} event`, () => {
    // Act.
    const eventMap = gridSectionElement.mapEvents();

    // Assert.
    // It should have a mapping for the proper events.
    expect(eventMap).toHaveProperty(
      ConnectedThumbnailGridSection.RELOAD_DATA_EVENT_NAME
    );

    // This should fire the appropriate action creator.
    const testEvent = { detail: [faker.datatype.uuid()] };
    eventMap[ConnectedThumbnailGridSection.RELOAD_DATA_EVENT_NAME](
      testEvent as unknown as Event
    );

    expect(mockThunkLoadThumbnails).toBeCalledTimes(1);
    expect(mockThunkLoadThumbnails).toBeCalledWith(testEvent.detail);
  });

  it(`maps the correct actions to the ${ConnectedThumbnailGridSection.DELETE_DATA_EVENT_NAME} event`, () => {
    // Act.
    const eventMap = gridSectionElement.mapEvents();

    // Assert.
    // It should have a mapping for the proper events.
    expect(eventMap).toHaveProperty(
      ConnectedThumbnailGridSection.DELETE_DATA_EVENT_NAME
    );

    // This should fire the appropriate action creator.
    const testEvent = { detail: [faker.datatype.uuid()] };
    eventMap[ConnectedThumbnailGridSection.DELETE_DATA_EVENT_NAME](
      testEvent as unknown as Event
    );

    expect(mockThunkClearEntities).toBeCalledTimes(1);
    expect(mockThunkClearEntities).toBeCalledWith(testEvent.detail);
  });
});
