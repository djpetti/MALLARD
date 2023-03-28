import { ConnectedNotesCard } from "../notes-card";
import {
  fakeImageEntity,
  fakeImageMetadata,
  fakeState,
} from "./element-test-utils";
import {
  createImageEntityId,
  thunkLoadMetadata,
} from "../thumbnail-grid-slice";
import each from "jest-each";
import { ImageEntity, ImageStatus } from "../types";

// I know this sounds insane, but when I import this as an ES6 module, faker.seed() comes up
// undefined. I can only assume this is a quirk in Babel.
const faker = require("faker");

jest.mock("../thumbnail-grid-slice", () => {
  const actualThumbnailGrid = jest.requireActual("../thumbnail-grid-slice");

  return {
    thunkLoadMetadata: jest.fn(),

    // Use the real implementation of the selectors.
    thumbnailGridSelectors: {
      selectById: actualThumbnailGrid.thumbnailGridSelectors.selectById,
    },
    createImageEntityId: actualThumbnailGrid.createImageEntityId,
  };
});

const mockThunkLoadMetadata = thunkLoadMetadata as jest.MockedFn<
  typeof thunkLoadMetadata
>;

jest.mock("@captaincodeman/redux-connect-element", () => ({
  // Turn connect() into a pass-through.
  connect: jest.fn((_, elementClass) => elementClass),
}));
jest.mock("../store", () => ({
  // Mock this to avoid an annoying spurious console error from Redux.
  configureStore: jest.fn(),
}));

describe("ConnectedNotesCard", () => {
  let notesCardElement: ConnectedNotesCard;

  beforeAll(() => {
    // Manually register the custom element.
    customElements.define(ConnectedNotesCard.tagName, ConnectedNotesCard);
  });

  beforeEach(() => {
    // Set a faker seed.
    faker.seed(1337);

    // Reset mocks.
    jest.clearAllMocks();

    notesCardElement = window.document.createElement(
      ConnectedNotesCard.tagName
    ) as ConnectedNotesCard;
    document.body.appendChild(notesCardElement);
  });

  afterEach(() => {
    document.body.getElementsByTagName(ConnectedNotesCard.tagName)[0].remove();
  });

  it("should render a loading indicator if metadata is undefined", async () => {
    // Act: Set the metadata property to undefined and wait for the component to render.
    notesCardElement.metadata = undefined;
    await notesCardElement.updateComplete;

    // Assert: The component should render a loading indicator.
    const progressIndicator = notesCardElement.shadowRoot!.querySelector(
      "mwc-circular-progress"
    );
    expect(progressIndicator).not.toBeNull();
  });

  it("should render notes if metadata is defined", async () => {
    // Arrange: Set the metadata property to a mock metadata object.
    const metadata = fakeImageMetadata();
    metadata.notes = faker.lorem.paragraph();
    notesCardElement.metadata = metadata;

    // Act: Wait for the component to render.
    await notesCardElement.updateComplete;

    // Assert: The component should render the notes.
    const noteText = notesCardElement.shadowRoot!.querySelector("#note_text");
    expect(noteText?.textContent).toBe(metadata.notes);
  });

  it("should render 'No notes.' if metadata is defined but notes is empty", async () => {
    // Arrange: Set the metadata property to a mock metadata object with an empty notes string.
    notesCardElement.metadata = {
      notes: "",
    };

    // Act: Wait for the component to render.
    await notesCardElement.updateComplete;

    // Assert: The component should render the "No notes." message.
    const noteText = notesCardElement.shadowRoot!.querySelector("#note_text");
    expect(noteText?.textContent).toBe("No notes.");
  });
});
