import { FileListDisplay } from "../file-list-display";
import { fakeFrontendFileEntity, getShadowRoot } from "./element-test-utils";
import { FileStatus, FrontendFileEntity } from "../types";
import { faker } from "@faker-js/faker";

describe("file-list-display", () => {
  /** Internal file-list to use for testing. */
  let fileList: FileListDisplay;

  beforeAll(() => {
    // Manually register the custom element.
    customElements.define(FileListDisplay.tagName, FileListDisplay);
  });

  beforeEach(() => {
    // Set the faker seed.
    faker.seed(1337);

    fileList = window.document.createElement(
      FileListDisplay.tagName
    ) as FileListDisplay;
    document.body.appendChild(fileList);
  });

  afterEach(() => {
    // Clean up the element we added.
    document.body.getElementsByTagName(FileListDisplay.tagName)[0].remove();
  });

  it("can be instantiated", () => {
    // Assert.
    expect(fileList.files).toHaveLength(0);
  });

  it("correctly renders files", async () => {
    // Arrange.
    // Create some fake files.
    const fakeFiles = new Array(100)
      .fill(0)
      .map((_) =>
        fakeFrontendFileEntity(
          faker.helpers.arrayElement(FileListDisplay.FILE_DISPLAY_ORDER)
        )
      );

    // Act.
    // Render some fake files.
    fileList.files = fakeFiles;
    await fileList.updateComplete;

    // Assert.
    const shadowRoot = getShadowRoot(fileList.tagName);
    const listItems = shadowRoot
      .querySelector("mwc-list")
      ?.querySelectorAll("mwc-list-item");

    // We should have one list item for each file. It will also insert a divider
    // after each one.
    expect(listItems).toHaveLength(fakeFiles.length);

    // It should correctly display the file names.
    const displayedNames = [];
    for (const listItem of listItems ?? []) {
      displayedNames.push(listItem.querySelector("span")?.textContent);
    }
    const fileNames = fakeFiles.map((f) => f.name);
    for (const fileName of fileNames) {
      expect(displayedNames).toContain(fileName);
    }

    // It should have displayed things in the correct order.
    const namesToFiles: Map<string, FrontendFileEntity> = new Map(
      fakeFiles.map((f) => [f.name, f])
    );
    // Whether we have seen at least one file with a particular status
    // when we iterate over the displayed items.
    const sawFileWithStatus: Map<FileStatus, boolean> = new Map([
      [FileStatus.UPLOADING, false],
      [FileStatus.AWAITING_UPLOAD, false],
      [FileStatus.PRE_PROCESSING, false],
      [FileStatus.PENDING, false],
      [FileStatus.COMPLETE, false],
    ]);
    for (const fileName of displayedNames) {
      const fileStatus = namesToFiles.get(fileName as string)
        ?.status as FileStatus;
      const statusOrder =
        FileListDisplay.FILE_DISPLAY_ORDER.indexOf(fileStatus);

      // Mark that we saw a file with this status.
      sawFileWithStatus.set(fileStatus, true);

      // Make sure that we haven't yet seen anything that comes after this in the
      // status order.
      for (const status of FileListDisplay.FILE_DISPLAY_ORDER.slice(
        statusOrder + 1
      )) {
        expect(sawFileWithStatus.get(status)).toEqual(false);
      }
    }
  });
});
