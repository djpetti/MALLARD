import { ArtifactThumbnail } from "../artifact-thumbnail";
import { getShadowRoot } from "./element_test_utils";

describe("artifact-thumbnail", () => {
  /** Internal artifact-thumbnail to use for testing. */
  let thumbnailElement: ArtifactThumbnail;

  beforeAll(() => {
    // Manually register the custom element.
    customElements.define(ArtifactThumbnail.tagName, ArtifactThumbnail);
  });

  beforeEach(() => {
    thumbnailElement = window.document.createElement(
      ArtifactThumbnail.tagName
    ) as ArtifactThumbnail;
    document.body.appendChild(thumbnailElement);
  });

  afterEach(() => {
    document.body.getElementsByTagName(ArtifactThumbnail.tagName)[0].remove();
  });

  it("can be instantiated", () => {
    // Assert.
    expect(thumbnailElement.imageId).toEqual(null);
  });

  it("displays no image by default", async () => {
    // Act.
    await thumbnailElement.updateComplete;

    // Assert.
    const thumbnailDiv = getShadowRoot(ArtifactThumbnail.tagName).querySelector(
      "#image_container"
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
    thumbnailElement.imageId = fakeImageId;
    await thumbnailElement.updateComplete;

    // Assert.
    // It should have caught the event.
    expect(handler).toBeCalledTimes(1);
  });
});
