import { getShadowRoot } from "./element-test-utils";
import each from "jest-each";
import { ArtifactDisplay } from "../artifact-display";
import { faker } from "@faker-js/faker";
import { ObjectType } from "mallard-api";

// Using older require syntax here so that we get the correct mock type.
const pageManager = require("../page-manager");
const mockPageManager = pageManager.PageManager;
const mockLoadPage = jest.fn();

jest.mock("../page-manager", () => ({
  PageManager: {
    getInstance: jest.fn(() => ({
      loadPage: mockLoadPage,
    })),
  },
}));

each([
  ["image", ObjectType.IMAGE],
  ["video", ObjectType.VIDEO],
]).describe("artifact-display (%s)", (_: string, objectType: ObjectType) => {
  /** Internal artifact-display to use for testing. */
  let displayElement: ArtifactDisplay;

  beforeAll(() => {
    // Manually register the custom element.
    if (!customElements.get(ArtifactDisplay.tagName)) {
      customElements.define(ArtifactDisplay.tagName, ArtifactDisplay);
    }
  });

  beforeEach(() => {
    // Set a faker seed.
    faker.seed(1337);

    // Reset the mocks.
    mockLoadPage.mockClear();
    mockPageManager.getInstance.mockClear();

    displayElement = window.document.createElement(
      ArtifactDisplay.tagName
    ) as ArtifactDisplay;
    displayElement.type = objectType;
    document.body.appendChild(displayElement);
  });

  afterEach(() => {
    document.body.getElementsByTagName(ArtifactDisplay.tagName)[0].remove();
  });

  it("can be instantiated", () => {
    // Assert.
    expect(displayElement.frontendId).toBeUndefined();
  });

  each([
    ["with a loading animation", true],
    ["without a loading animation", false],
  ]).it(
    "displays no image by default %s",
    async (_: string, showLoadingAnimation: boolean) => {
      // Arrange.
      displayElement.showLoadingAnimation = showLoadingAnimation;

      // Act.
      await displayElement.updateComplete;

      // Assert.
      const containerDiv = getShadowRoot(ArtifactDisplay.tagName).querySelector(
        "#media_container"
      ) as HTMLElement;
      // There should be no image element displayed.
      expect(containerDiv.getElementsByTagName("img").length).toEqual(0);
      expect(containerDiv.getElementsByTagName("video").length).toEqual(0);
      // The placeholder should be displayed.
      expect(containerDiv.classList).toContain("placeholder");

      // Check whether the loading animation is properly displayed.
      const loadingSpinners = containerDiv.getElementsByTagName(
        "mwc-circular-progress"
      );
      expect(loadingSpinners).toHaveLength(1);
      if (showLoadingAnimation) {
        expect(loadingSpinners[0].classList).not.toContain("hidden");
      } else {
        expect(loadingSpinners[0].classList).toContain("hidden");
      }

      // It should report that no image is specified.
      expect(displayElement.hasContent).toBe(false);
    }
  );

  it("displays an image when we set the URL", async () => {
    // Arrange.
    const fakeArtifactUrl = faker.image.imageUrl();

    // Act.
    // Set the URL.
    displayElement.sourceUrl = fakeArtifactUrl;

    await displayElement.updateComplete;

    // Assert.
    // It should have rendered the image.
    const containerDiv = getShadowRoot(ArtifactDisplay.tagName).querySelector(
      "#media_container"
    ) as HTMLElement;

    // The placeholder should not be displayed.
    expect(containerDiv.classList).not.toContain("placeholder");

    const artifacts = containerDiv.getElementsByTagName(
      objectType === ObjectType.IMAGE ? "img" : "video"
    );
    expect(artifacts).toHaveLength(1);

    // It should have set the correct image source.
    expect(artifacts[0].src).toEqual(fakeArtifactUrl);
  });

  it("handles clicks on the image correctly", async () => {
    // Arrange.
    // Create a fake image URL.
    displayElement.sourceUrl = faker.image.imageUrl();
    // Make the image link to a particular page.
    displayElement.onClickLink = faker.internet.url();

    // Act.
    await displayElement.updateComplete;

    // Try simulating a click event.
    const rootElement = getShadowRoot(ArtifactDisplay.tagName);
    const image = rootElement.querySelector("#media") as HTMLImageElement;
    image.dispatchEvent(new Event("click"));

    // Assert.
    // It should have called the handler.
    expect(mockLoadPage).toBeCalledTimes(1);
    expect(mockLoadPage).toBeCalledWith(displayElement.onClickLink);
  });

  it("removes the click handler if we un-set the image link", async () => {
    // Arrange.
    // Create a fake image URL.
    displayElement.sourceUrl = faker.image.imageUrl();
    // Make the image link to a particular page.
    displayElement.onClickLink = faker.internet.url();

    // Act.
    await displayElement.updateComplete;
    // Now, make the image link point nowhere, and update again.
    displayElement.onClickLink = undefined;
    await displayElement.updateComplete;

    // Try simulating a click event.
    const rootElement = getShadowRoot(ArtifactDisplay.tagName);
    const image = rootElement.querySelector("#media") as HTMLImageElement;
    image.dispatchEvent(new Event("click"));

    // Assert.
    // It should not have called the handler.
    expect(mockLoadPage).not.toBeCalled();
  });

  it("does not set a click handler if no image is set", async () => {
    // Arrange.
    // Make the image link point somewhere.
    displayElement.onClickLink = faker.internet.url();
    // Make the image link to a particular page.
    displayElement.onClickLink = faker.internet.url();

    // Act.
    await displayElement.updateComplete;
    // Now, make the image link point nowhere, and update again.
    displayElement.onClickLink = undefined;
    await displayElement.updateComplete;

    // No image should have been rendered.
    const rootElement = getShadowRoot(ArtifactDisplay.tagName);
    const image = rootElement.querySelector("#image");
    expect(image).toBeNull();
  });

  it("fires an event when we set the image ID", async () => {
    // Arrange.
    // Fake image ID to use for testing.
    const fakeImageId: string = "test-image-id";

    // Setup a fake handler for our event.
    const handler = jest.fn();
    displayElement.addEventListener(
      ArtifactDisplay.ARTIFACT_CHANGED_EVENT_NAME,
      handler
    );

    // Act.
    displayElement.frontendId = fakeImageId;
    await displayElement.updateComplete;

    // Assert.
    // It should have caught the event.
    expect(handler).toBeCalledTimes(1);
  });
});
