import { ConnectedArtifactDetails } from "../artifact-details";
import each from "jest-each";
import { fakeObjectRef, getShadowRoot } from "./element-test-utils";
import { ConnectedLargeImageDisplay } from "../large-image-display";
import { ConnectedMetadataCard } from "../metadata-card";
import { ConnectedNotesCard } from "../notes-card";

// I know this sounds insane, but when I import this as an ES6 module, faker.seed() comes up
// undefined. I can only assume this is a quirk in Babel.
const faker = require("faker");

jest.mock("../thumbnail-grid-slice", () => ({
  thunkShowDetails: jest.fn(),
}));

jest.mock("@captaincodeman/redux-connect-element", () => ({
  // Turn connect() into a pass-through.
  connect: jest.fn((_, elementClass) => elementClass),
}));
jest.mock("../store", () => ({
  // Mock this to avoid an annoying spurious console error from Redux.
  configureStore: jest.fn(),
}));

/**
 * A subclass of `ConnectedArtifactDetails` that exists solely so we can
 * access protected members for testing.
 */
class TestArtifactDetails extends ConnectedArtifactDetails {
  /**
   * Setter for the `frontendId` property.
   * @param {string?} frontendId Value to set `frontendId` to.
   */
  setFrontendId(frontendId?: string): void {
    this.frontendId = frontendId;
  }
}

describe("artifact-details", () => {
  /** Internal artifact-details element to use for testing. */
  let detailsElement: TestArtifactDetails;

  beforeAll(() => {
    // Manually register the custom element.
    customElements.define(TestArtifactDetails.tagName, TestArtifactDetails);
  });

  beforeEach(() => {
    // Set a faker seed.
    faker.seed(1337);

    // Reset mocks.
    jest.clearAllMocks();

    detailsElement = window.document.createElement(
      TestArtifactDetails.tagName
    ) as TestArtifactDetails;

    // Set a default backend ID, as most tests require this.
    const backendId = fakeObjectRef();
    detailsElement.backendBucket = backendId.bucket;
    detailsElement.backendName = backendId.name;

    document.body.appendChild(detailsElement);
  });

  afterEach(() => {
    document.body.getElementsByTagName(TestArtifactDetails.tagName)[0].remove();
  });

  each([
    ["an image is specified", faker.datatype.uuid()],
    ["no image is specified", undefined],
  ]).it("renders correctly when %s", async (_, frontendId?: string) => {
    // Arrange.
    // Set the frontend ID.
    detailsElement.setFrontendId(frontendId);

    // Act.
    await detailsElement.updateComplete;

    // Assert.
    // Check the sub-elements.
    const root = getShadowRoot(TestArtifactDetails.tagName);
    const imageDisplay = root.querySelector(
      ConnectedLargeImageDisplay.tagName
    ) as ConnectedLargeImageDisplay;
    const metadataCard = root.querySelector(
      ConnectedMetadataCard.tagName
    ) as ConnectedMetadataCard;
    const notesCard = root.querySelector(
      ConnectedNotesCard.tagName
    ) as ConnectedNotesCard;

    expect(imageDisplay).not.toBeNull();
    expect(imageDisplay.frontendId).toEqual(frontendId);

    expect(metadataCard).not.toBeNull();
    expect(metadataCard.frontendId).toEqual(frontendId);

    expect(notesCard).not.toBeNull();
    expect(notesCard.frontendId).toEqual(frontendId);
  });
});
