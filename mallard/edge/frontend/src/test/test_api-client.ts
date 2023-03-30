import { ImageQuery } from "../types";
import {
  batchUpdateMetadata,
  createImage,
  deleteImages,
  getMetadata,
  inferMetadata,
  loadImage,
  loadThumbnail,
  queryImages,
} from "../api-client";
import {
  fakeObjectRef,
  fakeImageMetadata,
  fakeOrdering,
} from "./element-test-utils";
import {
  ObjectRef,
  QueryResponse,
  UavImageMetadata,
  ImagesApi,
} from "mallard-api";
import each from "jest-each";

const faker = require("faker");

// Mock out the gateway API.
jest.mock("mallard-api");
// Deliberately using `any` here so we can make the API return any type of
// object instead of having to tediously simulate AxiosResponse.
const mockImagesApiClass = ImagesApi as jest.MockedClass<any>;

describe("api-client", () => {
  beforeEach(() => {
    jest.clearAllMocks();

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

    const resultsPerPage = faker.datatype.number();
    const imageIds: string[] = [];
    for (let i = 0; i < resultsPerPage; ++i) {
      imageIds.push(faker.datatype.uuid());
    }
    const pageNum: number = faker.datatype.number();
    const isLastPage: boolean = faker.datatype.boolean();
    mockQueryImages.mockResolvedValue({
      data: {
        imageIds: imageIds,
        pageNum: pageNum,
        isLastPage: isLastPage,
      },
    });

    const orderings = [fakeOrdering(), fakeOrdering()];
    const queries: ImageQuery[] = [{}];

    // Act.
    const result: QueryResponse = await queryImages(
      queries,
      orderings,
      resultsPerPage,
      pageNum
    );

    // Assert.
    // It should have queried the images.
    expect(mockQueryImages).toBeCalledTimes(1);
    expect(mockQueryImages).toBeCalledWith(resultsPerPage, pageNum, {
      queries: queries,
      orderings: orderings,
    });

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
    await expect(queryImages([{}])).rejects.toThrow(FakeAxiosError);

    // It should have logged the error information.
    expect(fakeError.toJSON).toBeCalledTimes(1);
  });

  it("can load an image", async () => {
    // Arrange.
    // Fake a valid response.
    const mockImageGet =
      mockImagesApiClass.prototype.getImageImagesBucketNameGet;

    const imageData = faker.image.cats(1920, 1080);
    mockImageGet.mockResolvedValue({ data: imageData });

    const imageId = { bucket: faker.lorem.word(), name: faker.datatype.uuid() };

    // Act.
    const result: Blob = await loadImage(imageId);

    // Assert.
    // It should have loaded the thumbnail.
    expect(mockImageGet).toBeCalledTimes(1);
    expect(mockImageGet).toBeCalledWith(
      imageId.bucket,
      imageId.name,
      expect.any(Object)
    );

    // It should have gotten the proper result.
    expect(result).toEqual(imageData);
  });

  it("handles a failure when loading an image", async () => {
    // Arrange.
    // Make it look like loading a thumbnail fails.
    const mockImageGet =
      mockImagesApiClass.prototype.getImageImagesBucketNameGet;
    const fakeError = new FakeAxiosError();
    mockImageGet.mockRejectedValue(fakeError);

    const imageId = { bucket: faker.lorem.word(), name: faker.datatype.uuid() };

    // Act and assert.
    await expect(loadImage(imageId)).rejects.toThrow(FakeAxiosError);

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
    const result: Blob = await loadThumbnail(imageId);

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

  it("can load metadata (%s)", async () => {
    // Arrange.
    // Fake a valid response.
    const mockMetadataGet =
      mockImagesApiClass.prototype.getImageMetadataImagesMetadataBucketNameGet;

    const metadata = fakeImageMetadata();
    mockMetadataGet.mockResolvedValue({ data: metadata });

    const imageId = { bucket: faker.lorem.word(), name: faker.datatype.uuid() };

    // Act.
    const result: UavImageMetadata = await getMetadata(imageId);

    // Assert.
    // It should have loaded the thumbnail.
    expect(mockMetadataGet).toBeCalledTimes(1);
    expect(mockMetadataGet).toBeCalledWith(imageId.bucket, imageId.name);

    // It should have gotten the proper result.
    expect(result).toEqual(metadata);
  });

  it("handles a failure when loading metadata", async () => {
    // Arrange.
    // Make it look like loading the metadata fails.
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

  each([
    ["location", true],
    ["no location", false],
  ]).it("can upload a new image", async (_: string, hasLocation: boolean) => {
    // Arrange.
    // Fake a valid response.
    const mockUavImageCreate =
      mockImagesApiClass.prototype.createUavImageImagesCreateUavPost;

    const artifactId = fakeObjectRef();
    mockUavImageCreate.mockResolvedValue({ data: { imageId: artifactId } });

    const imageData = new Blob([faker.datatype.string()]);
    const metadata = fakeImageMetadata();
    if (!hasLocation) {
      // Remove location data.
      metadata.location = undefined;
    }

    const fileName = faker.system.fileName();

    // Act.
    const result: ObjectRef = await createImage(imageData, {
      name: fileName,
      metadata: metadata,
    });

    // Assert.
    // It should have created the image.
    expect(mockUavImageCreate).toBeCalledTimes(1);
    // It should have specified the file name.
    expect(mockUavImageCreate.mock.calls[0][1].name).toEqual(fileName);
    // It should have specified the size in the metadata.
    expect(mockUavImageCreate.mock.calls[0][2]).toEqual(imageData.size);

    // It should have returned the ID of the artifact it created.
    expect(result).toEqual(artifactId);
  });

  it("handles a failure when creating the image", async () => {
    // Arrange.
    // Make it look like creating the image fails.
    const mockUavImageCreate =
      mockImagesApiClass.prototype.createUavImageImagesCreateUavPost;
    const fakeError = new FakeAxiosError();
    mockUavImageCreate.mockRejectedValue(fakeError);

    const imageData = faker.datatype.string();
    const metadata = fakeImageMetadata();

    // Act and assert.
    await expect(
      createImage(imageData, {
        name: faker.system.fileName(),
        metadata: metadata,
      })
    ).rejects.toThrow(FakeAxiosError);

    // It should have logged the error information.
    expect(fakeError.toJSON).toBeCalledTimes(1);
  });

  it("can delete images", async () => {
    // Arrange.
    // Fake a valid response.
    const mockImageDelete =
      mockImagesApiClass.prototype.deleteImagesImagesDeleteDelete;
    mockImageDelete.mockResolvedValue(undefined);

    const artifactIds = [fakeObjectRef(), fakeObjectRef()];

    // Act.
    await deleteImages(artifactIds);

    // Assert.
    // It should have deleted the images.
    expect(mockImageDelete).toBeCalledTimes(1);
    expect(mockImageDelete).toBeCalledWith(artifactIds);
  });

  it("handles a failure when deleting images", async () => {
    // Arrange.
    // Make it look like deleting the images fails.
    const mockUavImageDelete =
      mockImagesApiClass.prototype.deleteImagesImagesDeleteDelete;
    const fakeError = new FakeAxiosError();
    mockUavImageDelete.mockRejectedValue(fakeError);

    // Act and assert.
    await expect(deleteImages([fakeObjectRef()])).rejects.toThrow(
      FakeAxiosError
    );

    // It should have logged the error information.
    expect(fakeError.toJSON).toBeCalledTimes(1);
  });

  it("can infer metadata from an image", async () => {
    // Arrange.
    // Fake a valid response.
    const expectedResponse = fakeImageMetadata();
    const response: { [p in keyof UavImageMetadata]: any } = expectedResponse;
    // In real server responses, the enum values come as raw strings.
    response.format = response.format.toString();
    response.platformType = response.platformType.toString();

    const mockMetadataInfer =
      mockImagesApiClass.prototype.inferImageMetadataImagesMetadataInferPost;
    mockMetadataInfer.mockResolvedValue({ data: response });

    const imageData = new Blob([faker.datatype.string()]);
    const initialMetadata = fakeImageMetadata();

    const fileName = faker.system.fileName();

    // Act.
    const result: UavImageMetadata = await inferMetadata(imageData, {
      name: fileName,
      knownMetadata: initialMetadata,
    });

    // Assert.
    expect(mockMetadataInfer).toBeCalledTimes(1);
    // It should have specified the file name.
    expect(mockMetadataInfer.mock.calls[0][1].name).toEqual(fileName);
    // It should have specified the size in the metadata.
    expect(mockMetadataInfer.mock.calls[0][2]).toEqual(imageData.size);

    // It should have inferred the metadata.
    expect(result).toEqual(expectedResponse);
  });

  it("handles a failure when inferring metadata", async () => {
    // Arrange.
    // Make it look like inferring the metadata failed.
    const mockMetadataInfer =
      mockImagesApiClass.prototype.inferImageMetadataImagesMetadataInferPost;
    const fakeError = new FakeAxiosError();
    mockMetadataInfer.mockRejectedValue(fakeError);

    const imageData = faker.datatype.string();
    const metadata = fakeImageMetadata();

    // Act and assert.
    await expect(
      inferMetadata(imageData, {
        name: faker.system.fileName(),
        knownMetadata: metadata,
      })
    ).rejects.toThrow(FakeAxiosError);

    // It should have logged the error information.
    expect(fakeError.toJSON).toBeCalledTimes(1);
  });

  it("can update existing image metadata", async () => {
    // Arrange.
    const metadata = fakeImageMetadata();
    const images: ObjectRef[] = [];
    for (let i = 0; i < 10; ++i) {
      images.push(fakeObjectRef());
    }

    const incrementSequence = faker.datatype.boolean();

    const mockUpdateMetadata =
      mockImagesApiClass.prototype
        .batchUpdateMetadataImagesMetadataBatchUpdatePatch;
    mockUpdateMetadata.mockResolvedValue({});

    // Act.
    await batchUpdateMetadata(metadata, images, incrementSequence);

    // Assert.
    // It should have updated the metadata.
    expect(mockUpdateMetadata).toBeCalledWith(
      { metadata: metadata, images: images },
      incrementSequence
    );
  });

  it("handles a failure when updating metadata", async () => {
    // Arrange.
    // Make it look like updating the metadata failed.
    const mockUpdateMetadata =
      mockImagesApiClass.prototype
        .batchUpdateMetadataImagesMetadataBatchUpdatePatch;
    const fakeError = new FakeAxiosError();
    mockUpdateMetadata.mockRejectedValue(fakeError);

    const metadata = fakeImageMetadata();

    // Act and assert.
    await expect(batchUpdateMetadata(metadata, [])).rejects.toThrow(
      FakeAxiosError
    );

    // It should have logged the error information.
    expect(fakeError.toJSON).toBeCalledTimes(1);
  });
});
