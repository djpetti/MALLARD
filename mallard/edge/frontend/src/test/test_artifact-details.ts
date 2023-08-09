import { ConnectedArtifactDetails } from "../artifact-details";
import each from "jest-each";
import { fakeObjectRef, fakeState, getShadowRoot } from "./element-test-utils";
import { ConnectedLargeArtifactDisplay } from "../large-artifact-display";
import { ConnectedMetadataCard } from "../metadata-card";
import { ConnectedNotesCard } from "../notes-card";
import { ObjectRef } from "mallard-api";
import { thunkShowDetails } from "../thumbnail-grid-slice";
import { faker } from "@faker-js/faker";

jest.mock("../thumbnail-grid-slice", () => ({
  thunkShowDetails: jest.fn(),
}));

const mockThunkShowDetails = thunkShowDetails as jest.MockedFn<
  typeof thunkShowDetails
>;

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
      ConnectedLargeArtifactDisplay.tagName
    ) as ConnectedLargeArtifactDisplay;
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

  it("fires an event when the image is changed", async () => {
    // Arrange.
    // Set up an event handler.
    const imageChangedEventHandler = jest.fn();
    detailsElement.addEventListener(
      TestArtifactDetails.IMAGE_CHANGED_EVENT_NAME,
      imageChangedEventHandler
    );

    const imageId = fakeObjectRef();

    // Act.
    // Set the new image ID.
    detailsElement.backendBucket = imageId.bucket;
    detailsElement.backendName = imageId.name;

    await detailsElement.updateComplete;

    // Also try setting them back, which should not fire an event.
    detailsElement.backendBucket = undefined;
    detailsElement.backendName = undefined;

    await detailsElement.updateComplete;

    // Assert.
    // It should have fired the event.
    expect(imageChangedEventHandler).toBeCalledTimes(1);
  });

  it("updates the properties based on the Redux state", () => {
    // Arrange.
    // Create the state.
    const state = fakeState();
    // Make it look like we have a new image being displayed on the details
    // page.
    state.imageView.details.frontendId = faker.datatype.uuid();

    // Act.
    const gotUpdates = detailsElement.mapState(state);

    // Assert.
    // It should have updated the frontend ID.
    expect(gotUpdates).toHaveProperty("frontendId");
    expect(gotUpdates.frontendId).toEqual(state.imageView.details.frontendId);
  });

  it(`dispatches the correct action when the ${TestArtifactDetails.IMAGE_CHANGED_EVENT_NAME} is fired`, () => {
    // Arrange.
    // Get the mapping of events to actions.
    const eventMap = detailsElement.mapEvents();

    const backendId = fakeObjectRef();

    // Act.
    // Simulate the event being fired.
    expect(eventMap).toHaveProperty(
      TestArtifactDetails.IMAGE_CHANGED_EVENT_NAME
    );
    eventMap[TestArtifactDetails.IMAGE_CHANGED_EVENT_NAME](
      new CustomEvent<ObjectRef>(TestArtifactDetails.IMAGE_CHANGED_EVENT_NAME, {
        bubbles: true,
        composed: false,
        detail: backendId,
      })
    );

    // Assert.
    // It should have called the action creator.
    expect(mockThunkShowDetails).toBeCalledWith(backendId);
  });
});
