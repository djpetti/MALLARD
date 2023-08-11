import { downloadZip, predictLength } from "client-zip";
import MockedFn = jest.MockedFn;
import {
  fakeImageMetadata,
  fakeTypedObjectRef,
  fakeVideoMetadata,
} from "./element-test-utils";
import { downloadArtifactZip, makeArtifactUrlList } from "../downloads";
import streamSaver from "streamsaver";
import each from "jest-each";
import { faker } from "@faker-js/faker";
import { ObjectType } from "mallard-api";

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

// Mock out `createObjectURL`.
const mockCreateObjectUrl = jest.fn();
global.URL.createObjectURL = mockCreateObjectUrl;

// Mock out the File API.
const mockFileConstructor = jest.fn();
global.File = mockFileConstructor;

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
      const image = fakeTypedObjectRef(ObjectType.IMAGE);
      const video = fakeTypedObjectRef(ObjectType.VIDEO);
      const imageMetadata = fakeImageMetadata();
      const videoMetadata = fakeVideoMetadata();
      const artifactsWithMeta = [
        { id: image, metadata: imageMetadata },
        { id: video, metadata: videoMetadata },
      ];

      // Make it look like we can predict the length.
      const zipLength = BigInt(faker.datatype.number({ min: 0 }));
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
      await downloadArtifactZip(artifactsWithMeta);
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
      expect(allUrls).toContain(image.id.bucket);
      expect(allUrls).toContain(image.id.name);
      expect(allUrls).toContain(video.id.bucket);
      expect(allUrls).toContain(video.id.name);

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

  it("handles duplicate names correctly", async () => {
    // Arrange.
    // Create some fake images with the same name.
    const image1 = fakeTypedObjectRef(ObjectType.IMAGE);
    const image2 = fakeTypedObjectRef(ObjectType.IMAGE);
    const image3 = fakeTypedObjectRef(ObjectType.IMAGE);
    const metadata1 = fakeImageMetadata();
    const imagesWithMeta = [
      { id: image1, metadata: metadata1 },
      { id: image2, metadata: metadata1 },
      { id: image3, metadata: metadata1 },
    ];

    // Make it look like we can predict the length.
    const zipLength = BigInt(faker.datatype.number({ min: 0 }));
    mockPredictLength.mockReturnValue(zipLength);

    // Create some sort of fake file stream for it to write to.
    const fakeFileStream = {};
    mockCreateWriteStream.mockReturnValue(fakeFileStream as WritableStream);

    // Don't use the fancy mock implementation here. For our purposes, we
    // actually *don't* want it to step through the iterable, so that we can
    // extract the iterable and check it later.
    mockDownloadZip.mockImplementation((_) => {
      return { body: { pipeTo: mockPipeTo } } as unknown as Response;
    });

    // Act.
    await downloadArtifactZip(imagesWithMeta);

    // Assert.
    // It should have predicted the length.
    expect(mockPredictLength).toBeCalledTimes(1);

    expect(mockDownloadZip).toBeCalledTimes(1);
    // It should have specified the correct length.
    expect(mockDownloadZip).toBeCalledWith(expect.anything(), {
      length: zipLength,
    });

    // It should have made the names unique.
    const imageIter = mockDownloadZip.mock.calls[0][0];
    const imageNames = new Set<string>();
    for await (const image of imageIter) {
      const name = (image as { name: any }).name as string;
      expect(imageNames.has(name)).toBe(false);
      imageNames.add(name);
    }
    expect(imageNames.size).toBe(3);
  });

  it("should create a file containing the list of URLs and return the link", () => {
    // Arrange
    const imageIds = [
      fakeTypedObjectRef(),
      fakeTypedObjectRef(),
      fakeTypedObjectRef(),
    ];

    // Make sure createObjectUrl produces a valid result.
    const fakeFileUrl = faker.internet.url();
    mockCreateObjectUrl.mockReturnValue(fakeFileUrl);

    // Act
    const gotFileUrl = makeArtifactUrlList(imageIds);

    // Assert
    // Verify the returned value is a valid URL.
    expect(mockCreateObjectUrl).toBeCalledTimes(1);
    expect(gotFileUrl).toEqual(fakeFileUrl);

    // Check the file metadata.
    expect(mockFileConstructor).toBeCalledTimes(1);
    expect(mockFileConstructor).toBeCalledWith(
      expect.anything(),
      "image_urls.txt",
      { type: "text/plain" }
    );

    // Check the file contents.
    const actualUrlList = mockFileConstructor.mock.calls[0][0];
    // The file should contain a list of URLs.
    for (let i = 0; i < actualUrlList.length; ++i) {
      expect(actualUrlList[i]).toContain(imageIds[i].id.bucket);
      expect(actualUrlList[i]).toContain(imageIds[i].id.name);
    }
  });
});
