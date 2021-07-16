import { FileList } from "../file-list";
import { fakeFrontendFileEntity, getShadowRoot } from "./element-test-utils";
import { FileStatus, FrontendFileEntity } from "../types";

// I know this sounds insane, but when I import this as an ES6 module, faker.seed() comes up
// undefined. I can only assume this is a quirk in Babel.
const faker = require("faker");

describe("file-list", () => {
  /** Internal file-list to use for testing. */
  let fileList: FileList;

  beforeAll(() => {
    // Manually register the custom element.
    customElements.define(FileList.tagName, FileList);
  });

  beforeEach(() => {
    // Set the faker seed.
    faker.seed(1337);

    fileList = window.document.createElement(FileList.tagName) as FileList;
    document.body.appendChild(fileList);
  });

  afterEach(() => {
    // Clean up the element we added.
    document.body.getElementsByTagName(FileList.tagName)[0].remove();
  });

  it("can be instantiated", () => {
    // Assert.
    expect(fileList.files).toHaveLength(0);
  });

  it("correctly renders files", async () => {
    // Arrange.
    // Create some fake files to test with.
    const pendingFile1 = fakeFrontendFileEntity();
    pendingFile1.status = FileStatus.PENDING;
    const pendingFile2 = fakeFrontendFileEntity();
    pendingFile2.status = FileStatus.PENDING;
    const processingFile = fakeFrontendFileEntity();
    processingFile.status = FileStatus.PROCESSING;
    const completeFile = fakeFrontendFileEntity();
    completeFile.status = FileStatus.COMPLETE;

    // Act.
    // Render the files.
    fileList.files = [completeFile, pendingFile1, processingFile, pendingFile2];
    await fileList.updateComplete;

    // Assert.
    const shadowRoot = getShadowRoot(fileList.tagName);
    const listItems = shadowRoot
      .querySelector("mwc-list")
      ?.querySelectorAll("mwc-list-item");

    // We should have one list item for each file. It will also insert a divider
    // after each one.
    expect(listItems).toHaveLength(4);

    // It should correctly display the file names.
    const displayedNames = [];
    for (const listItem of listItems ?? []) {
      displayedNames.push(listItem.querySelector("span")?.textContent);
    }
    const fileNames = [
      pendingFile1,
      pendingFile2,
      processingFile,
      completeFile,
    ].map((f) => f.name);
    for (const fileName of fileNames) {
      expect(displayedNames).toContain(fileName);
    }

    // It should have displayed things in the correct order.
    const namesToFiles: Map<string, FrontendFileEntity> = new Map(
      [pendingFile1, pendingFile2, processingFile, completeFile].map((f) => [
        f.name,
        f,
      ])
    );
    const statusToFiles: Map<FileStatus, string[]> = new Map([
      [FileStatus.PENDING, [pendingFile1.name, pendingFile2.name]],
      [FileStatus.PROCESSING, [processingFile.name]],
      [FileStatus.COMPLETE, [completeFile.name]],
    ]);
    // Whether we have seen at least one file with a particular status
    // when we iterate over the displayed items.
    const sawFileWithStatus: Map<FileStatus, boolean> = new Map([
      [FileStatus.PENDING, false],
      [FileStatus.PROCESSING, false],
      [FileStatus.COMPLETE, false],
    ]);
    for (const fileName of displayedNames) {
      const fileStatus = namesToFiles.get(fileName as string)
        ?.status as FileStatus;
      const statusOrder = FileList.FILE_DISPLAY_ORDER.indexOf(fileStatus);

      // Mark that we saw a file with this status.
      sawFileWithStatus.set(fileStatus, true);

      // Make sure that we haven't yet seen anything that comes after this in the
      // status order.
      for (const status of FileList.FILE_DISPLAY_ORDER.slice(statusOrder + 1)) {
        expect(sawFileWithStatus.get(status)).toEqual(false);
      }
    }
  });
});
