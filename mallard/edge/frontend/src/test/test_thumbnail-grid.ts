import { ConnectedThumbnailGrid } from "../thumbnail-grid";
import {
  fakeState,
  fakeThumbnailEntity,
  getShadowRoot,
} from "./element-test-utils";
import { ThumbnailGridSection } from "../thumbnail-grid-section";
import { RootState, ThumbnailStatus } from "../types";

const faker = require("faker");

jest.mock("@captaincodeman/redux-connect-element", () => ({
  // Turn connect() into a pass-through.
  connect: jest.fn((_, elementClass) => elementClass),
}));

describe("thumbnail-grid", () => {
  /** Internal thumbnail-grid to use for testing. */
  let gridElement: ConnectedThumbnailGrid;

  beforeAll(() => {
    // Manually register the custom element.
    customElements.define(
      ConnectedThumbnailGrid.tagName,
      ConnectedThumbnailGrid
    );
  });

  beforeEach(() => {
    // Set a faker seed.
    faker.seed(1337);

    gridElement = window.document.createElement(
      ConnectedThumbnailGrid.tagName
    ) as ConnectedThumbnailGrid;
    document.body.appendChild(gridElement);
  });

  afterEach(() => {
    document.body
      .getElementsByTagName(ConnectedThumbnailGrid.tagName)[0]
      .remove();
  });

  it("renders thumbnails correctly", async () => {
    // Arrange.
    // Add some fake artifacts.
    gridElement.displayedArtifacts = [faker.random.uuid(), faker.random.uuid()];

    // Act.
    await gridElement.updateComplete;

    // Assert.
    // It should have rendered the thumbnail.
    const root = getShadowRoot(ConnectedThumbnailGrid.tagName);
    const gridDiv = root.querySelector(".thumbnail_grid") as HTMLElement;
    expect(gridDiv).not.toBe(null);
    expect(gridDiv.childElementCount).toEqual(1);

    // It should have set the correct thumbnails.
    const gridSection = gridDiv.children[0] as ThumbnailGridSection;
    expect(gridSection.displayedArtifacts).toEqual(
      gridElement.displayedArtifacts
    );
  });

  it("updates the properties from the Redux state", () => {
    // Arrange.
    const imageId = faker.random.uuid();

    // Create a fake state.
    const state: RootState = fakeState();
    state.thumbnailGrid.ids = [imageId];
    state.thumbnailGrid.entities[imageId] = fakeThumbnailEntity(false);

    // Act.
    const updates = gridElement.mapState(state);

    // Assert.
    // It should have gotten the correct updates.
    expect(updates).toHaveProperty("displayedArtifacts");
    expect(updates["displayedArtifacts"]).toEqual(state.thumbnailGrid.ids);
  });
});
