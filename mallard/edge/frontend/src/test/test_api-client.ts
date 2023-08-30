import { ImageQuery } from "../types";
import {
  batchUpdateMetadata,
  createImage,
  deleteImages,
  getArtifactUrl,
  getMetadata,
  getPreviewVideoUrl,
  getStreamableVideoUrl,
  inferMetadata,
  loadImage,
  loadThumbnail,
  queryImages,
} from "../api-client";
import {
  fakeObjectRef,
  fakeImageMetadata,
  fakeOrdering,
  fakeTypedObjectRef,
  fakeVideoMetadata,
} from "./element-test-utils";
import {
  ObjectRef,
  QueryResponse,
  UavImageMetadata,
  ImagesApi,
  DefaultApi,
  TypedObjectRef,
  UavVideoMetadata,
  VideosApi,
  ObjectType,
} from "mallard-api";
import each from "jest-each";
import { faker } from "@faker-js/faker";
import { cloneDeep } from "lodash";

// Mock out the gateway API.
jest.mock("mallard-api");
// Deliberately using `any` here so we can make the API return any type of
// object instead of having to tediously simulate AxiosResponse.
const mockImagesApiClass = ImagesApi as jest.MockedClass<typeof ImagesApi>;
const mockVideosApiClass = VideosApi as jest.MockedClass<typeof VideosApi>;
const mockApiClass = DefaultApi as jest.MockedClass<typeof DefaultApi>;

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
    const mockQueryImages = mockApiClass.prototype.queryArtifactsQueryPost;

    const resultsPerPage = faker.datatype.number();
    const imageIds: TypedObjectRef[] = [];
    for (let i = 0; i < resultsPerPage; ++i) {
      imageIds.push(fakeTypedObjectRef());
    }
    const pageNum: number = faker.datatype.number();
    const isLastPage: boolean = faker.datatype.boolean();
    // @ts-ignore
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
    const mockQueryImages = mockApiClass.prototype.queryArtifactsQueryPost;
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
    // @ts-ignore
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
      mockApiClass.prototype.getThumbnailThumbnailBucketNameGet;

    const imageData = faker.image.cats(128, 128);
    // @ts-ignore
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
      mockApiClass.prototype.getThumbnailThumbnailBucketNameGet;
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
    const mockFindImageMetadata =
      mockImagesApiClass.prototype.findImageMetadataImagesMetadataPost;
    const mockFindVideoMetadata =
      mockVideosApiClass.prototype.findVideoMetadataVideosMetadataPost;

    const videoMetadata = fakeVideoMetadata();
    const imageMetadata = fakeImageMetadata();

    // @ts-ignore
    mockFindImageMetadata.mockResolvedValue({
      data: { metadata: [imageMetadata] },
    });
    // @ts-ignore
    mockFindVideoMetadata.mockResolvedValue({
      data: { metadata: [videoMetadata] },
    });

    const imageArtifactId = fakeTypedObjectRef(ObjectType.IMAGE);
    const videoArtifactId = fakeTypedObjectRef(ObjectType.VIDEO);

    // Act.
    const result: (UavImageMetadata | UavVideoMetadata)[] = await getMetadata([
      videoArtifactId,
      imageArtifactId,
    ]);

    // Assert.
    // It should have loaded the metadata.
    expect(mockFindImageMetadata).toBeCalledTimes(1);
    expect(mockFindImageMetadata).toBeCalledWith([
      { bucket: imageArtifactId.id.bucket, name: imageArtifactId.id.name },
    ]);

    expect(mockFindVideoMetadata).toBeCalledTimes(1);
    expect(mockFindVideoMetadata).toBeCalledWith([
      { bucket: videoArtifactId.id.bucket, name: videoArtifactId.id.name },
    ]);

    // It should have gotten the proper result in the right order.
    expect(result).toEqual([videoMetadata, imageMetadata]);
  });

  each([
    ["image", ObjectType.IMAGE],
    ["video", ObjectType.VIDEO],
  ]).it(
    "handles a failure when loading %s metadata",
    async (_: string, objectType: ObjectType) => {
      // Arrange.
      // Make it look like loading the metadata fails.
      const mockFindMetadata =
        objectType === ObjectType.IMAGE
          ? mockImagesApiClass.prototype.findImageMetadataImagesMetadataPost
          : mockVideosApiClass.prototype.findVideoMetadataVideosMetadataPost;
      const fakeError = new FakeAxiosError();
      mockFindMetadata.mockRejectedValue(fakeError);

      const artifactId = fakeTypedObjectRef(objectType);

      // Act and assert.
      await expect(getMetadata([artifactId])).rejects.toThrow(FakeAxiosError);

      // It should have logged the error information.
      expect(fakeError.toJSON).toBeCalledTimes(1);
    }
  );

  each([
    ["location", true],
    ["no location", false],
  ]).it("can upload a new image", async (_: string, hasLocation: boolean) => {
    // Arrange.
    // Fake a valid response.
    const mockUavImageCreate =
      mockImagesApiClass.prototype.createUavImageImagesCreateUavPost;

    const artifactId = fakeObjectRef();
    // @ts-ignore
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

    const imageData = new Blob([faker.datatype.string()]);
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
    // @ts-ignore
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
    // @ts-ignore
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

    const imageData = new Blob([faker.datatype.string()]);
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

  each([
    [
      "image metadata, ignoring the names and sizes",
      true,
      true,
      fakeImageMetadata(),
      ObjectType.IMAGE,
    ],
    [
      "image metadata, setting the names and sizes",
      false,
      false,
      fakeImageMetadata(),
      ObjectType.IMAGE,
    ],
    ["video metadata", false, false, fakeVideoMetadata(), ObjectType.VIDEO],
  ]).it(
    "can update existing image metadata, %s",
    async (
      _,
      ignoreName: boolean,
      ignoreSize: boolean,
      metadata: UavImageMetadata | UavVideoMetadata,
      objectType: ObjectType
    ) => {
      // Arrange.
      const artifacts: TypedObjectRef[] = [];
      for (let i = 0; i < 10; ++i) {
        artifacts.push(fakeTypedObjectRef(objectType));
      }

      const incrementSequence = faker.datatype.boolean();

      const mockUpdateMetadata =
        objectType == ObjectType.IMAGE
          ? mockImagesApiClass.prototype
              .batchUpdateMetadataImagesMetadataBatchUpdatePatch
          : mockVideosApiClass.prototype
              .batchUpdateMetadataVideosMetadataBatchUpdatePatch;
      // @ts-ignore
      mockUpdateMetadata.mockResolvedValue({});

      // Act.
      await batchUpdateMetadata(
        metadata,
        artifacts,
        incrementSequence,
        ignoreName,
        ignoreSize
      );

      // Assert.
      const expectedMetadata = cloneDeep(metadata);
      if (ignoreName) {
        // We shouldn't have set the name.
        expectedMetadata.name = undefined;
      }
      if (ignoreSize) {
        // We shouldn't have set the size.
        expectedMetadata.size = undefined;
      }

      // It should have updated the metadata.
      const untypedIds = artifacts.map((a) => a.id);
      expect(mockUpdateMetadata).toBeCalledWith(
        objectType === ObjectType.IMAGE
          ? { metadata: expectedMetadata, images: untypedIds }
          : { metadata: expectedMetadata, videos: untypedIds },
        incrementSequence
      );
    }
  );

  each([
    ["image", fakeImageMetadata(), ObjectType.IMAGE],
    ["video", fakeVideoMetadata(), ObjectType.VIDEO],
  ]).it(
    "handles a failure when updating %s metadata",
    async (
      _: string,
      metadata: UavImageMetadata | UavVideoMetadata,
      objectType: ObjectType
    ) => {
      // Arrange.
      // Make it look like updating the metadata failed.
      const mockUpdateMetadata =
        objectType === ObjectType.IMAGE
          ? mockImagesApiClass.prototype
              .batchUpdateMetadataImagesMetadataBatchUpdatePatch
          : mockVideosApiClass.prototype
              .batchUpdateMetadataVideosMetadataBatchUpdatePatch;
      const fakeError = new FakeAxiosError();
      mockUpdateMetadata.mockRejectedValue(fakeError);

      // Act and assert.
      await expect(
        batchUpdateMetadata(metadata, [fakeTypedObjectRef(objectType)])
      ).rejects.toThrow(FakeAxiosError);

      // It should have logged the error information.
      expect(fakeError.toJSON).toBeCalledTimes(1);
    }
  );

  each([
    ["image", ObjectType.IMAGE],
    ["video", ObjectType.VIDEO],
  ]).it("can get the URL for a(n) %s", (_: string, objectType: ObjectType) => {
    // Arrange.
    const artifactId = fakeTypedObjectRef(objectType);

    // Act.
    const gotUrl = getArtifactUrl(artifactId);

    // Assert.
    if (objectType === ObjectType.IMAGE) {
      expect(gotUrl).toContain("images");
    } else {
      expect(gotUrl).toContain("videos");
    }

    expect(gotUrl).toContain(`${artifactId.id.bucket}/${artifactId.id.name}`);
  });

  each([
    ["image", ObjectType.IMAGE],
    ["video", ObjectType.VIDEO],
  ]).it(
    "can get the preview video URL for a(n) %s",
    (_: string, objectType: ObjectType) => {
      // Arrange.
      const artifactId = fakeTypedObjectRef(objectType);

      // Act.
      const gotUrl = getPreviewVideoUrl(artifactId);

      // Assert.
      if (objectType === ObjectType.IMAGE) {
        // It should just return null for non-video artifacts.
        expect(gotUrl).toBeNull();
      } else {
        expect(gotUrl).toContain("videos");
        expect(gotUrl).toContain(
          `${artifactId.id.bucket}/${artifactId.id.name}`
        );
      }
    }
  );

  each([
    ["image", ObjectType.IMAGE],
    ["video", ObjectType.VIDEO],
  ]).it(
    "can get the streamble video URL for a(n) %s",
    (_: string, objectType: ObjectType) => {
      // Arrange.
      const artifactId = fakeTypedObjectRef(objectType);

      // Act.
      const gotUrl = getStreamableVideoUrl(artifactId);

      // Assert.
      if (objectType === ObjectType.IMAGE) {
        // It should just return null for non-video artifacts.
        expect(gotUrl).toBeNull();
      } else {
        expect(gotUrl).toContain("videos");
        expect(gotUrl).toContain(
          `${artifactId.id.bucket}/${artifactId.id.name}`
        );
      }
    }
  );
});
