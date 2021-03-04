import { ArtifactThumbnail } from "../artifact-thumbnail";

describe("artifact-thumbnail", () => {
  /** Tag name for the artifact-thumbnail element. */
  const THUMBNAIL_TAG: string = "artifact-thumbnail-unconnected";
  /** Internal artifact-thumbnail to use for testing. */
  let thumbnailElement: ArtifactThumbnail;

  /**
   * Gets the root node in the shadow DOM for an element.
   * @param {string} tagName The tag name of the element. Will get the first element with this tag.
   * @return {ShadowRoot} The root node of the shadow DOM.
   */
  const getShadowRoot = (tagName: string): ShadowRoot => {
    return document.body.getElementsByTagName(tagName)[0]
      .shadowRoot as ShadowRoot;
  };

  beforeEach(() => {
    thumbnailElement = window.document.createElement(
      THUMBNAIL_TAG
    ) as ArtifactThumbnail;
    document.body.appendChild(thumbnailElement);
  });

  afterEach(() => {
    document.body.getElementsByTagName(THUMBNAIL_TAG)[0].remove();
  });

  it("can be instantiated", () => {
    // Assert.
    expect(thumbnailElement.getAttribute("imageId")).toEqual(null);
  });

  it("displays no image by default", async () => {
    // Act.
    await thumbnailElement.updateComplete;

    // Assert.
    const thumbnailDiv = getShadowRoot(THUMBNAIL_TAG).getElementById(
      "image_container"
    ) as HTMLElement;
    // There should be no image element displayed.
    expect(thumbnailDiv.getElementsByTagName("img").length).toEqual(0);

    // It should report that no image is specified.
    expect(thumbnailElement.hasImage).toBe(false);
  });

  it("fires an event when we set the image ID", async () => {
    // Arrange.
    // Fake image ID to use for testing.
    const fakeImageId: string = "test-image-id";

    // Setup a fake handler for our event.
    const handler = jest.fn();
    thumbnailElement.addEventListener("image-changed", handler);

    // Act.
    thumbnailElement.setAttribute("imageId", fakeImageId);
    await thumbnailElement.updateComplete;

    // Assert.
    // It should have caught the event.
    expect(handler).toBeCalledTimes(1);
  });
});
