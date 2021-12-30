import { getShadowRoot } from "./element-test-utils";
import each from "jest-each";
import { ImageDisplay } from "../image-display";

// I know this sounds insane, but when I import this as an ES6 module, faker.seed() comes up
// undefined. I can only assume this is a quirk in Babel.
const faker = require("faker");

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

  each([
    ["with a link", faker.internet.url()],
    ["without a link", undefined],
  ]).it(
    "displays an image when we set the URL %s",
    async (_: string, linkUrl?: string) => {
      // Arrange.
      const fakeImageUrl = faker.image.imageUrl();

      // Act.
      // Set the URL.
      imageElement.imageUrl = fakeImageUrl;
      // Set the image to link to somewhere.
      imageElement.imageLink = linkUrl;

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

      if (linkUrl) {
        // It should have made the image into a link.
        const links = containerDiv.getElementsByTagName("a");
        expect(links).toHaveLength(1);

        // The href property seems to add a trailing slash, so we use
        // toContain.
        expect(links[0].href).toContain(linkUrl);
      }

      // It should have set the correct image source.
      expect(images[0].src).toEqual(fakeImageUrl);
    }
  );

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
