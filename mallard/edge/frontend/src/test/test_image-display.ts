import { getShadowRoot } from "./element-test-utils";
import each from "jest-each";
import { ImageDisplay } from "../image-display";

// I know this sounds insane, but when I import this as an ES6 module, faker.seed() comes up
// undefined. I can only assume this is a quirk in Babel.
const faker = require("faker");

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

describe("image-display", () => {
  /** Internal artifact-thumbnail to use for testing. */
  let imageElement: ImageDisplay;

  beforeAll(() => {
    // Manually register the custom element.
    customElements.define(ImageDisplay.tagName, ImageDisplay);
  });

  beforeEach(() => {
    // Set a faker seed.
    faker.seed(1337);

    // Reset the mocks.
    mockLoadPage.mockClear();
    mockPageManager.getInstance.mockClear();

    imageElement = window.document.createElement(
      ImageDisplay.tagName
    ) as ImageDisplay;
    document.body.appendChild(imageElement);
  });

  afterEach(() => {
    document.body.getElementsByTagName(ImageDisplay.tagName)[0].remove();
  });

  it("can be instantiated", () => {
    // Assert.
    expect(imageElement.frontendId).toBeUndefined();
  });

  each([
    ["with a loading animation", true],
    ["without a loading animation", false],
  ]).it(
    "displays no image by default %s",
    async (_: string, showLoadingAnimation: boolean) => {
      // Arrange.
      imageElement.showLoadingAnimation = showLoadingAnimation;

      // Act.
      await imageElement.updateComplete;

      // Assert.
      const containerDiv = getShadowRoot(ImageDisplay.tagName).querySelector(
        "#image_container"
      ) as HTMLElement;
      // There should be no image element displayed.
      expect(containerDiv.getElementsByTagName("img").length).toEqual(0);
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
      expect(imageElement.hasImage).toBe(false);
    }
  );

  it("displays an image when we set the URL", async () => {
    // Arrange.
    const fakeImageUrl = faker.image.imageUrl();

    // Act.
    // Set the URL.
    imageElement.imageUrl = fakeImageUrl;

    await imageElement.updateComplete;

    // Assert.
    // It should have rendered the image.
    const containerDiv = getShadowRoot(ImageDisplay.tagName).querySelector(
      "#image_container"
    ) as HTMLElement;

    // The placeholder should not be displayed.
    expect(containerDiv.classList).not.toContain("placeholder");

    const images = containerDiv.getElementsByTagName("img");
    expect(images).toHaveLength(1);

    // It should have set the correct image source.
    expect(images[0].src).toEqual(fakeImageUrl);
  });

  it("handles clicks on the image correctly", async () => {
    // Arrange.
    // Create a fake image URL.
    imageElement.imageUrl = faker.image.imageUrl();
    // Make the image link to a particular page.
    imageElement.imageLink = faker.internet.url();

    // Act.
    await imageElement.updateComplete;

    // Try simulating a click event.
    const rootElement = getShadowRoot(ImageDisplay.tagName);
    const image = rootElement.querySelector("#image") as HTMLImageElement;
    image.dispatchEvent(new Event("click"));

    // Assert.
    // It should have called the handler.
    expect(mockLoadPage).toBeCalledTimes(1);
    expect(mockLoadPage).toBeCalledWith(imageElement.imageLink);
  });

  it("removes the click handler if we un-set the image link", async () => {
    // Arrange.
    // Create a fake image URL.
    imageElement.imageUrl = faker.image.imageUrl();
    // Make the image link to a particular page.
    imageElement.imageLink = faker.internet.url();

    // Act.
    await imageElement.updateComplete;
    // Now, make the image link point nowhere, and update again.
    imageElement.imageLink = undefined;
    await imageElement.updateComplete;

    // Try simulating a click event.
    const rootElement = getShadowRoot(ImageDisplay.tagName);
    const image = rootElement.querySelector("#image") as HTMLImageElement;
    image.dispatchEvent(new Event("click"));

    // Assert.
    // It should not have called the handler.
    expect(mockLoadPage).not.toBeCalled();
  });

  it("does not set a click handler if no image is set", async () => {
    // Arrange.
    // Make the image link point somewhere.
    imageElement.imageLink = faker.internet.url();
    // Make the image link to a particular page.
    imageElement.imageLink = faker.internet.url();

    // Act.
    await imageElement.updateComplete;
    // Now, make the image link point nowhere, and update again.
    imageElement.imageLink = undefined;
    await imageElement.updateComplete;

    // No image should have been rendered.
    const rootElement = getShadowRoot(ImageDisplay.tagName);
    const image = rootElement.querySelector("#image");
    expect(image).toBeNull();
  });

  it("fires an event when we set the image ID", async () => {
    // Arrange.
    // Fake image ID to use for testing.
    const fakeImageId: string = "test-image-id";

    // Setup a fake handler for our event.
    const handler = jest.fn();
    imageElement.addEventListener(
      ImageDisplay.IMAGE_CHANGED_EVENT_NAME,
      handler
    );

    // Act.
    imageElement.frontendId = fakeImageId;
    await imageElement.updateComplete;

    // Assert.
    // It should have caught the event.
    expect(handler).toBeCalledTimes(1);
  });
});
