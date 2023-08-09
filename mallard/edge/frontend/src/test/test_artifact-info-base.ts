import { ConnectedNotesCard } from "../notes-card";
import {
  fakeArtifactEntity,
  fakeImageMetadata,
  fakeState,
} from "./element-test-utils";
import {
  createArtifactEntityId,
  thunkLoadMetadata,
} from "../thumbnail-grid-slice";
import each from "jest-each";
import { ArtifactEntity, ArtifactStatus } from "../types";
import { ConnectedMetadataCard } from "../metadata-card";
import { ComponentType } from "../elements";
import { ArtifactInfoBase } from "../artifact-info-base";
import { Action } from "redux";
import { faker } from "@faker-js/faker";

jest.mock("../thumbnail-grid-slice", () => {
  const actualThumbnailGrid = jest.requireActual("../thumbnail-grid-slice");

  return {
    thunkLoadMetadata: jest.fn(),

    // Use the real implementation of the selectors.
    thumbnailGridSelectors: {
      selectById: actualThumbnailGrid.thumbnailGridSelectors.selectById,
    },
    createArtifactEntityId: actualThumbnailGrid.createArtifactEntityId,
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

/**
 * Interface for components that have been connected to Redux.
 */
interface ConnectedComponentType extends ComponentType {
  mapState: (state: any) => { [p: string]: any };
  mapEvents: () => { [p: string]: (event: Event) => Action };
}

each([
  ["NotesCard", ConnectedNotesCard],
  ["MetadataCard", ConnectedMetadataCard],
]).describe(
  "%s (base class methods)",
  (_, elementClass: ConnectedComponentType & typeof ArtifactInfoBase) => {
    let element: ArtifactInfoBase & ConnectedComponentType;

    beforeAll(() => {
      // Manually register the custom element.
      customElements.define(elementClass.tagName, elementClass);
    });

    beforeEach(() => {
      // Set a faker seed.
      faker.seed(1337);

      // Reset mocks.
      jest.clearAllMocks();

      element = window.document.createElement(
        elementClass.tagName
      ) as ArtifactInfoBase & ConnectedComponentType;
      document.body.appendChild(element);
    });

    afterEach(() => {
      document.body.getElementsByTagName(elementClass.tagName)[0].remove();
    });

    it("fires an event when the frontend ID changes", async () => {
      // Arrange.
      // Add a fake handler for the event.
      const artifactChangedEventHandler = jest.fn();
      element.addEventListener(
        elementClass.ARTIFACT_CHANGED_EVENT_NAME,
        artifactChangedEventHandler
      );

      const frontendId = faker.datatype.uuid();

      // Act.
      element.frontendId = frontendId;
      await element.updateComplete;

      // Assert.
      // It should have fired the event.
      expect(artifactChangedEventHandler).toBeCalledTimes(1);
      expect(artifactChangedEventHandler.mock.calls[0][0].detail).toEqual(
        frontendId
      );
    });

    describe("mapState()", () => {
      it("does not update when there is no frontendId", () => {
        // Arrange.
        element.frontendId = undefined;

        const state = fakeState();

        // Act.
        const gotUpdates = element.mapState(state);

        // Assert.
        expect(gotUpdates).toEqual({});
      });

      each([
        ["the artifact is not registered", ArtifactStatus.LOADED, undefined],
        [
          "the metadata is not loaded",
          ArtifactStatus.LOADING,
          fakeArtifactEntity(),
        ],
      ]).it(
        "does not update when %s",
        (_, metadataStatus: ArtifactStatus, imageEntity?: ArtifactEntity) => {
          // Arrange.
          // Set a fake frontend ID.
          element.frontendId = faker.datatype.uuid();

          const state = fakeState();
          // Add the entity if necessary.
          if (imageEntity) {
            const imageId = createArtifactEntityId(imageEntity.backendId.id);
            state.imageView.ids = [imageId];
            state.imageView.entities[imageId] = imageEntity;

            // Set the correct status.
            imageEntity.metadataStatus = metadataStatus;
          }

          // Act.
          const gotUpdates = element.mapState(state);

          // Assert.
          // It should not have updated.
          expect(gotUpdates).toEqual({});
        }
      );

      it("updates the metadata", () => {
        // Arrange.
        const state = fakeState();
        const imageEntity = fakeArtifactEntity();
        imageEntity.metadata = fakeImageMetadata();
        imageEntity.metadataStatus = ArtifactStatus.LOADED;
        const imageId = createArtifactEntityId(imageEntity.backendId.id);
        state.imageView.ids = [imageId];
        state.imageView.entities[imageId] = imageEntity;

        // Set a fake frontend ID.
        element.frontendId = imageId;

        // Act.
        const gotUpdates = element.mapState(state);

        // Assert.
        expect(gotUpdates).toHaveProperty("metadata");
        expect(gotUpdates.metadata).toEqual(imageEntity.metadata);
      });
    });

    it(`dispatches the proper action creator for the ${elementClass.ARTIFACT_CHANGED_EVENT_NAME} event`, () => {
      // Arrange.
      // Get the event mapping.
      const eventMap = element.mapEvents();

      const frontendId = faker.datatype.uuid();

      // Act.
      // Call the event handler.
      expect(eventMap).toHaveProperty(elementClass.ARTIFACT_CHANGED_EVENT_NAME);
      eventMap[elementClass.ARTIFACT_CHANGED_EVENT_NAME](
        new CustomEvent<string>(elementClass.ARTIFACT_CHANGED_EVENT_NAME, {
          bubbles: true,
          composed: false,
          detail: frontendId,
        })
      );

      // Assert.
      // It should have called the action creator.
      expect(mockThunkLoadMetadata).toBeCalledWith([frontendId]);
    });
  }
);
