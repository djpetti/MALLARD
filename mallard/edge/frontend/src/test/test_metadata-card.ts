import { ConnectedMetadataCard, MetadataCard } from "../metadata-card";
import { PlatformType } from "mallard-api";
import { fakeImageMetadata, getShadowRoot } from "./element-test-utils";
import each from "jest-each";
import { faker } from "@faker-js/faker";

describe("MetadataCard", () => {
  let metadataCardElement: ConnectedMetadataCard;

  beforeAll(() => {
    // Manually register the custom element.
    customElements.define(ConnectedMetadataCard.tagName, ConnectedMetadataCard);
  });

  beforeEach(() => {
    // Set a faker seed.
    faker.seed(1337);

    // Reset mocks.
    jest.clearAllMocks();

    metadataCardElement = window.document.createElement(
      ConnectedMetadataCard.tagName
    ) as ConnectedMetadataCard;
    document.body.appendChild(metadataCardElement);
  });

  afterEach(() => {
    document.body.getElementsByTagName(MetadataCard.tagName)[0].remove();
  });

  describe("render", () => {
    it("displays loading indicator when metadata is undefined", async () => {
      // Arrange
      metadataCardElement.metadata = undefined;

      // Act
      await metadataCardElement.updateComplete;

      // Assert
      const root = getShadowRoot(ConnectedMetadataCard.tagName);
      const loadingIndicator = root.querySelector("mwc-circular-progress");
      expect(loadingIndicator).not.toBeNull();
    });

    each([
      ["ground", PlatformType.GROUND],
      ["aerial", PlatformType.AERIAL],
    ]).it(
      "displays image metadata when metadata is defined and the platform is %s",
      async (_, platform: PlatformType) => {
        // Arrange
        const metadata = fakeImageMetadata();
        metadata.platformType = platform;

        metadataCardElement.metadata = metadata;

        // Act
        await metadataCardElement.updateComplete;

        // Assert
        const root = getShadowRoot(ConnectedMetadataCard.tagName);
        const elementHtml = root.innerHTML;
        expect(elementHtml).toContain(metadata.name);
        expect(elementHtml).toContain(metadata.sessionName);
        expect(elementHtml).toContain(metadata.captureDate);
        expect(elementHtml).toContain(metadata.camera);
        if (metadata.platformType == PlatformType.AERIAL) {
          // Searching for numbers is not the most reliable, so we just
          // search for field names.
          expect(elementHtml).toContain("Flight Altitude");
          expect(elementHtml).toContain("Ground Sample Distance");
        } else {
          expect(elementHtml).not.toContain("Flight Altitude");
          expect(elementHtml).not.toContain("Ground Sample Distance");
        }
      }
    );
  });
});
