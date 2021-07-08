import { BackendImageMetadata, ImageQuery, QueryResult } from "../types";
import { getMetadata, loadThumbnail, queryImages } from "../api-client";

const faker = require("faker");

// Using older require syntax here so we get the correct mock type.
const axios = require("typescript-axios");
const mockImagesApiClass: jest.Mock = axios.ImagesApi;

// Mock out the gateway API.
jest.mock("typescript-axios");

describe("api-client", () => {
  beforeEach(() => {
    // Clear all instances, calls to the constructor, and method calls.
    mockImagesApiClass.mockClear();

    // Set the faker seed.
    faker.seed(1337);
  });

  /**
   * Fake exception resembling errors from Axios.
   */
  class FakeAxiosError extends Error {
    /**
     * Creates a new error.
     */
    constructor() {
      super();
      this.toJSON = jest.fn();
    }

    toJSON: () => string;
  }

  it("can query images", async () => {
    // Arrange.
    // Fake a valid response.
    const mockQueryImages =
      mockImagesApiClass.prototype.queryImagesImagesQueryPost;

    const imageIds: string[] = [faker.datatype.uuid(), faker.datatype.uuid()];
    const pageNum: number = faker.random.number();
    const isLastPage: boolean = faker.random.boolean();
    mockQueryImages.mockResolvedValue({
      data: {
        image_ids: imageIds,
        page_num: pageNum,
        is_last_page: isLastPage,
      },
    });

    const query: ImageQuery = {};

    // Act.
    const result: QueryResult = await queryImages(query);

    // Assert.
    // It should have queried the images.
    expect(mockQueryImages).toBeCalledTimes(1);
    expect(mockQueryImages).toBeCalledWith(
      expect.any(Number),
      expect.any(Number),
      query
    );

    // It should have gotten the proper result.
    expect(result.imageIds).toEqual(imageIds);
    expect(result.pageNum).toEqual(pageNum);
    expect(result.isLastPage).toEqual(isLastPage);
  });

  it("handles a failure when querying images", async () => {
    // Arrange.
    // Make it look like querying images fails.
    const mockQueryImages =
      mockImagesApiClass.prototype.queryImagesImagesQueryPost;
    const fakeError = new FakeAxiosError();
    mockQueryImages.mockRejectedValue(fakeError);

    // Act and assert.
    await expect(queryImages({})).rejects.toThrow(FakeAxiosError);

    // It should have logged the error information.
    expect(fakeError.toJSON).toBeCalledTimes(1);
  });

  it("can load a thumbnail", async () => {
    // Arrange.
    // Fake a valid response.
    const mockThumbnailGet =
      mockImagesApiClass.prototype.getThumbnailImagesThumbnailBucketNameGet;

    const imageData = faker.image.cats(128, 128);
    mockThumbnailGet.mockResolvedValue({ data: imageData });

    const imageId = { bucket: faker.lorem.word(), name: faker.datatype.uuid() };

    // Act.
    const result: string = await loadThumbnail(imageId);

    // Assert.
    // It should have loaded the thumbnail.
    expect(mockThumbnailGet).toBeCalledTimes(1);
    expect(mockThumbnailGet).toBeCalledWith(
      imageId.bucket,
      imageId.name,
      expect.any(Object)
    );

    // It should have gotten the proper result.
    expect(result).toEqual(imageData);
  });

  it("handles a failure when loading a thumbnail", async () => {
    // Arrange.
    // Make it look like loading a thumbnail fails.
    const mockThumbnailGet =
      mockImagesApiClass.prototype.getThumbnailImagesThumbnailBucketNameGet;
    const fakeError = new FakeAxiosError();
    mockThumbnailGet.mockRejectedValue(fakeError);

    const imageId = { bucket: faker.lorem.word(), name: faker.datatype.uuid() };

    // Act and assert.
    await expect(loadThumbnail(imageId)).rejects.toThrow(FakeAxiosError);

    // It should have logged the error information.
    expect(fakeError.toJSON).toBeCalledTimes(1);
  });

  it("can load metadata", async () => {
    // Arrange.
    // Fake a valid response.
    const mockMetadataGet =
      mockImagesApiClass.prototype.getImageMetadataImagesMetadataBucketNameGet;

    const captureDate = faker.date.past().toISOString();
    mockMetadataGet.mockResolvedValue({ data: { capture_date: captureDate } });

    const imageId = { bucket: faker.lorem.word(), name: faker.datatype.uuid() };

    // Act.
    const result: BackendImageMetadata = await getMetadata(imageId);

    // Assert.
    // It should have loaded the thumbnail.
    expect(mockMetadataGet).toBeCalledTimes(1);
    expect(mockMetadataGet).toBeCalledWith(imageId.bucket, imageId.name);

    // It should have gotten the proper result.
    expect(result).toEqual({ captureDate: captureDate });
  });

  it("handles a failure when loading metadata", async () => {
    // Arrange.
    // Make it look like loading a thumbnail fails.
    const mockMetadataGet =
      mockImagesApiClass.prototype.getImageMetadataImagesMetadataBucketNameGet;
    const fakeError = new FakeAxiosError();
    mockMetadataGet.mockRejectedValue(fakeError);

    const imageId = { bucket: faker.lorem.word(), name: faker.datatype.uuid() };

    // Act and assert.
    await expect(getMetadata(imageId)).rejects.toThrow(FakeAxiosError);

    // It should have logged the error information.
    expect(fakeError.toJSON).toBeCalledTimes(1);
  });
});
