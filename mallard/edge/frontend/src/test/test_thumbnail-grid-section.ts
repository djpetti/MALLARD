import { ThumbnailGridSection } from "../thumbnail-grid-section";
import { getShadowRoot } from "./element-test-utils";
import { ArtifactThumbnail } from "../artifact-thumbnail";

describe("thumbnail-grid-section", () => {
  /** Internal thumbnail-grid-section to use for testing. */
  let gridSectionElement: ThumbnailGridSection;

  beforeAll(() => {
    // Manually register the custom element.
    customElements.define(ThumbnailGridSection.tagName, ThumbnailGridSection);
  });

  beforeEach(() => {
    gridSectionElement = window.document.createElement(
      ThumbnailGridSection.tagName
    ) as ThumbnailGridSection;
    document.body.appendChild(gridSectionElement);
  });

  afterEach(() => {
    document.body
      .getElementsByTagName(ThumbnailGridSection.tagName)[0]
      .remove();
  });

  it("correctly renders when empty", () => {
    // Assert.
    // It should have no thumbnails displayed.
    expect(gridSectionElement.displayedArtifacts.length).toEqual(0);

    // It should not have rendered the section header.
    const root = getShadowRoot(ThumbnailGridSection.tagName);
    expect(root.querySelectorAll(".section_divider").length).toEqual(0);
  });

  it("correctly renders when not empty", async () => {
    // Arrange.
    // Add a few thumbnails.
    gridSectionElement.displayedArtifacts = ["steven", "bob"];
    // Set a header.
    gridSectionElement.sectionHeader = "My Header";

    // Act.
    await gridSectionElement.updateComplete;

    // Assert.
    const root = getShadowRoot(ThumbnailGridSection.tagName);

    // It should have rendered the correct header.
    const divider = root.querySelector("#section_divider") as HTMLElement;
    expect(divider).not.toBe(null);
    expect(divider.textContent).toEqual("My Header");

    // It should have rendered the correct thumbnails.
    const contents = root.querySelector("#section_contents") as HTMLElement;
    expect(contents).not.toBe(null);
    expect(contents.childElementCount).toBe(2);
    for (const thumbnail of contents.children) {
      expect(gridSectionElement.displayedArtifacts).toContain(
        (thumbnail as ArtifactThumbnail).frontendId
      );
    }
  });
});
