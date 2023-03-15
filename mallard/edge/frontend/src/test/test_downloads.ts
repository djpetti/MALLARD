import { downloadZip, predictLength } from "client-zip";
import MockedFn = jest.MockedFn;
import { fakeImageMetadata, fakeObjectRef } from "./element-test-utils";
import { downloadImageZip } from "../downloads";
import streamSaver from "streamsaver";
import each from "jest-each";

const faker = require("faker");

jest.mock("client-zip", () => ({
  downloadZip: jest.fn(),
  predictLength: jest.fn(),
}));
const mockDownloadZip = downloadZip as MockedFn<typeof downloadZip>;
const mockPredictLength = predictLength as MockedFn<typeof predictLength>;

jest.mock("streamsaver", () => ({
  createWriteStream: jest.fn(),
}));
const mockCreateWriteStream = streamSaver.createWriteStream as MockedFn<
  typeof streamSaver.createWriteStream
>;

// Mock out `fetch`.
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("downloads", () => {
  /** Set to true once downloadZip has finished executing. */
  let downloadZipFinished = false;
  /** Mock function so we can tell when we're piping our response. */
  const mockPipeTo = jest.fn();

  /** Original value of the FS Access API functions. */
  const originalShowSaveFilePicker = global.showSaveFilePicker;

  beforeEach(() => {
    // Set the faker seed.
    faker.seed(1337);

    jest.clearAllMocks();
    // Clean up mocked FS Access API if we added it.
    global.showSaveFilePicker = originalShowSaveFilePicker;

    downloadZipFinished = false;
    // Set the downloadZip implementation to actually iterate through
    // the URLs it's passed so that code gets tested.
    mockDownloadZip.mockImplementation((images) => {
      /**
       * Helper function that steps through an async iterable.
       */
      async function unwindIterable() {
        for await (const _ of images) {
        }
      }

      unwindIterable().then(() => (downloadZipFinished = true));

      return { body: { pipeTo: mockPipeTo } } as unknown as Response;
    });
  });

  each([
    ["the FS Access API is available", true],
    ["the FS Access API is not available", false],
  ]).it(
    "can download some images when %s",
    async (_, simulateFsAccessApi: boolean) => {
      // Arrange.
      // Create some fake images.
      const image1 = fakeObjectRef();
      const image2 = fakeObjectRef();
      const metadata1 = fakeImageMetadata();
      const metadata2 = fakeImageMetadata();
      const imagesWithMeta = [
        { id: image1, metadata: metadata1 },
        { id: image2, metadata: metadata2 },
      ];

      // Make it look like we can predict the length.
      const zipLength = faker.datatype.number({ min: 0 });
      mockPredictLength.mockReturnValue(zipLength);

      // Create some sort of fake file stream for it to write to.
      const fakeFileStream = {};
      mockCreateWriteStream.mockReturnValue(fakeFileStream as WritableStream);

      let mockShowSaveFilePicker:
        | jest.MockedFn<typeof global.showSaveFilePicker>
        | undefined = undefined;
      if (simulateFsAccessApi) {
        //  Make it look like the FS Access API is available.
        const fileHandle = { createWritable: jest.fn() };
        fileHandle.createWritable.mockResolvedValue(fakeFileStream);

        global.showSaveFilePicker = jest.fn();
        mockShowSaveFilePicker = global.showSaveFilePicker as jest.MockedFn<
          typeof global.showSaveFilePicker
        >;
        mockShowSaveFilePicker.mockResolvedValue(
          fileHandle as unknown as FileSystemFileHandle
        );
      }

      // Act.
      await downloadImageZip(imagesWithMeta);
      // Wait for it to fully finish running.
      while (!downloadZipFinished) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Assert.
      // It should have predicted the length.
      expect(mockPredictLength).toBeCalledTimes(1);

      expect(mockDownloadZip).toBeCalledTimes(1);
      // It should have specified the correct length.
      expect(mockDownloadZip).toBeCalledWith(expect.anything(), {
        length: zipLength,
      });

      // It should have fetched the images.
      expect(mockFetch).toBeCalledTimes(2);
      // We don't care about the order, or the exact API call, so we're just
      // going to concatenate all the fetched URLs into a big string and look
      // for our image IDs.
      const allUrls = mockFetch.mock.calls.map((c) => c[0]).join("");
      expect(allUrls).toContain(image1.bucket);
      expect(allUrls).toContain(image1.name);
      expect(allUrls).toContain(image2.bucket);
      expect(allUrls).toContain(image2.name);

      // It should have written out the data to the file.
      if (simulateFsAccessApi) {
        expect(mockShowSaveFilePicker).toBeCalledTimes(1);
      } else {
        expect(mockCreateWriteStream).toBeCalledTimes(1);
        expect(mockCreateWriteStream).toBeCalledWith(expect.anything(), {
          size: zipLength,
        });
      }
      expect(mockPipeTo).toBeCalledWith(fakeFileStream);
    }
  );
});
