import { ImageQuery } from "../types";
import {
  batchUpdateMetadata,
  createImage,
  createVideo,
  deleteImages,
  getArtifactUrl,
  getMetadata,
  getPreviewVideoUrl,
  getStreamableVideoUrl,
  getUserInfo,
  getUserProfileUrl,
  inferImageMetadata,
  inferVideoMetadata,
  loadImage,
  loadThumbnail,
  logout,
  queryImages,
} from "../api-client";
import {
  fakeObjectRef,
  fakeImageMetadata,
  fakeOrdering,
  fakeTypedObjectRef,
  fakeVideoMetadata,
  fakeUserInfo,
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
import { AxiosRequestConfig } from "axios";
import { browser, Fief, FiefAccessTokenExpired } from "@fief/fief";

// Mock out the gateway API.
jest.mock("mallard-api");
const mockImagesApiClass = ImagesApi as jest.MockedClass<typeof ImagesApi>;
const mockVideosApiClass = VideosApi as jest.MockedClass<typeof VideosApi>;
const mockApiClass = DefaultApi as jest.MockedClass<typeof DefaultApi>;

// Mock out Fief.
jest.mock("@fief/fief");
const mockFiefAuth = browser.FiefAuth as jest.MockedClass<
  typeof browser.FiefAuth
>;
const mockFiefClient = Fief as jest.MockedClass<typeof Fief>;

// Mock out session locking.
const mockLockRequest = jest.fn();
Object.defineProperty(global.navigator, "locks", {
  value: { request: mockLockRequest },
});

// Base URL for Fief authentication.
declare const AUTH_BASE_URL: string;

describe("api-client", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Set the faker seed.
    faker.seed(1337);

    // Make it so requesting a lock transparently runs the callback.
    mockLockRequest.mockImplementation(
      async (_: string, callback: () => Promise<void>) => await callback()
    );
    // Default to making it look like a user is logged in.
    mockFiefAuth.prototype.isAuthenticated.mockReturnValue(true);
    mockFiefAuth.prototype.getTokenInfo.mockReturnValue({
      access_token: faker.datatype.string(25),
      id_token: faker.datatype.string(25),
      expires_in: faker.datatype.number(),
      token_type: "bearer",
    });

    // Clear relevant data from local storage.
    window.localStorage.removeItem("pre_auth_location");
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

  it("can get information about the current user", () => {
    // Arrange.
    const userInfo = fakeUserInfo();
    mockFiefAuth.prototype.getUserinfo.mockReturnValue(userInfo);

    // Act.
    const gotUserInfo = getUserInfo();

    // Assert.
    expect(gotUserInfo).toEqual(userInfo);
  });

  it("can get the correct user profile URL", () => {
    // Act and assert.
    expect(getUserProfileUrl()).toEqual(AUTH_BASE_URL);
  });

  it("can log the current user out", () => {
    // Arrange.
    // This function will be used as the promise to run when logging out. In
    // the actual implementation, it doesn't need to do anything, we just
    // need to be sure that it runs.
    const onLogout = jest.fn();
    // Set up the logout function.
    mockFiefAuth.prototype.logout.mockReturnValue(new Promise(onLogout));

    // Act.
    logout();

    // Assert.
    // It should have called the logout function with the current URL.
    expect(mockFiefAuth.prototype.logout).toBeCalledTimes(1);
    expect(mockFiefAuth.prototype.logout).toBeCalledWith(window.location.href);
    // It should have resolved the promise.
    expect(onLogout).toBeCalledTimes(1);
  });

  each([
    ["token is missing", false],
    ["token is invalid", true],
  ]).it(
    "can redirect the user to the login page when the %s",
    async (_: string, hasToken: boolean) => {
      // Arrange.
      // Make it look like the user isn't logged in.
      mockFiefAuth.prototype.isAuthenticated.mockReturnValue(hasToken);
      if (hasToken) {
        // In this case, we have a token, but it is invalid.
        mockFiefClient.prototype.validateAccessToken.mockImplementationOnce(
          () => {
            throw FiefAccessTokenExpired;
          }
        );
      }

      // Set this up so the function call doesn't fail.
      const mockThumbnailGet =
        mockApiClass.prototype.getThumbnailThumbnailBucketNameGet;
      // @ts-ignore
      mockThumbnailGet.mockResolvedValue({ data: undefined });

      // Act.
      // Call a function that requires login.
      await loadThumbnail(fakeObjectRef());

      // Assert.
      // It should have checked login status.
      expect(mockFiefAuth.prototype.isAuthenticated).toBeCalledTimes(1);
      // It should have saved the location.
      expect(window.localStorage.getItem("pre_auth_location")).toEqual(
        window.location.href
      );
      // It should have redirected to the login page.
      expect(mockFiefAuth.prototype.redirectToLogin).toBeCalledTimes(1);
    }
  );

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
    expect(mockQueryImages).toBeCalledWith(
      resultsPerPage,
      pageNum,
      undefined,
      {
        queries: queries,
        orderings: orderings,
      },
      { headers: { Authorization: expect.any(String) } }
    );

    // It should have gotten the proper result.
    expect(result.imageIds).toEqual(imageIds);
    expect(result.pageNum).toEqual(pageNum);
    expect(result.isLastPage).toEqual(isLastPage);
  });

  describe("authentication", () => {
    it("can get information about the current user", () => {
      // Arrange.
    });
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
      undefined,
      { responseType: "blob", headers: { Authorization: expect.any(String) } }
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
      undefined,
      { responseType: "blob", headers: { Authorization: expect.any(String) } }
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
    expect(mockFindImageMetadata).toBeCalledWith(
      [{ bucket: imageArtifactId.id.bucket, name: imageArtifactId.id.name }],
      undefined,
      { headers: { Authorization: expect.any(String) } }
    );

    expect(mockFindVideoMetadata).toBeCalledTimes(1);
    expect(mockFindVideoMetadata).toBeCalledWith(
      [{ bucket: videoArtifactId.id.bucket, name: videoArtifactId.id.name }],
      undefined,
      { headers: { Authorization: expect.any(String) } }
    );

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
    ["location", true, undefined],
    ["no location", false, undefined],
    ["a progress callback", false, jest.fn()],
  ]).it(
    "can upload a new image with %s",
    async (
      _: string,
      hasLocation: boolean,
      progressCallback?: jest.MockedFn<any>
    ) => {
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
      const result: ObjectRef = await createImage(
        imageData,
        {
          name: fileName,
          metadata: metadata,
        },
        progressCallback
      );

      // Assert.
      // It should have created the image.
      expect(mockUavImageCreate).toBeCalledTimes(1);
      // It should have specified the file name.
      const callArgs = mockUavImageCreate.mock.calls[0];
      expect(callArgs[1].name).toEqual(fileName);
      // It should not have passed a token in the query.
      expect(callArgs[2]).toBeUndefined();
      // It should have specified the size in the metadata.
      expect(callArgs[3]).toEqual(imageData.size);

      // It should have specified the authentication token.
      const gotConfig = callArgs[callArgs.length - 1] as AxiosRequestConfig;
      expect(gotConfig.headers).toEqual({ Authorization: expect.any(String) });

      if (progressCallback !== undefined) {
        // It should have specified the progress callback.
        expect(gotConfig).toHaveProperty("onUploadProgress");

        // Calling it should run the callback.
        (gotConfig["onUploadProgress"] as (progressEvent: any) => void)({
          loaded: 1,
          total: 10,
        });
        expect(progressCallback).toBeCalledWith(10);
      }

      // It should have returned the ID of the artifact it created.
      expect(result).toEqual(artifactId);
    }
  );

  each([
    ["location", true, undefined],
    ["no location", false, undefined],
    ["a progress callback", false, jest.fn()],
  ]).it(
    "can upload a new video with %s",
    async (
      _: string,
      hasLocation: boolean,
      progressCallback?: jest.MockedFn<any>
    ) => {
      // Arrange.
      // Fake a valid response.
      const mockUavVideoCreate =
        mockVideosApiClass.prototype.createUavVideoVideosCreateUavPost;

      const artifactId = fakeObjectRef();
      // @ts-ignore
      mockUavVideoCreate.mockResolvedValue({ data: { videoId: artifactId } });

      const videoData = new Blob([faker.datatype.string()]);
      const metadata = fakeVideoMetadata();
      if (!hasLocation) {
        // Remove location data.
        metadata.location = undefined;
      }

      const fileName = faker.system.fileName();

      // Act.
      const result: ObjectRef = await createVideo(
        videoData,
        {
          name: fileName,
          metadata: metadata,
        },
        progressCallback
      );

      // Assert.
      // It should have created the image.
      expect(mockUavVideoCreate).toBeCalledTimes(1);
      // It should have specified the file name.
      const callArgs = mockUavVideoCreate.mock.calls[0];
      expect(callArgs[0].name).toEqual(fileName);
      // It should not have passed a token in the query.
      expect(callArgs[1]).toBeUndefined();
      // It should have specified the size in the metadata.
      expect(callArgs[2]).toEqual(videoData.size);

      // It should have specified the authentication token.
      const gotConfig = callArgs[callArgs.length - 1] as AxiosRequestConfig;
      expect(gotConfig.headers).toEqual({ Authorization: expect.any(String) });

      if (progressCallback !== undefined) {
        // It should have specified the progress callback.
        const gotConfig = callArgs[callArgs.length - 1] as AxiosRequestConfig;
        expect(gotConfig).toHaveProperty("onUploadProgress");

        // Calling it should run the callback.
        (gotConfig["onUploadProgress"] as (progressEvent: any) => void)({
          loaded: 1,
          total: 10,
        });
        expect(progressCallback).toBeCalledWith(10);
      }

      // It should have returned the ID of the artifact it created.
      expect(result).toEqual(artifactId);
    }
  );

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

  it("handles a failure when creating the video", async () => {
    // Arrange.
    // Make it look like creating the image fails.
    const mockUavVideoCreate =
      mockVideosApiClass.prototype.createUavVideoVideosCreateUavPost;
    const fakeError = new FakeAxiosError();
    mockUavVideoCreate.mockRejectedValue(fakeError);

    const imageData = new Blob([faker.datatype.string()]);
    const metadata = fakeVideoMetadata();

    // Act and assert.
    await expect(
      createVideo(imageData, {
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
    expect(mockImageDelete).toBeCalledWith(artifactIds, undefined, {
      headers: { Authorization: expect.any(String) },
    });
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
    const result: UavImageMetadata = await inferImageMetadata(imageData, {
      name: fileName,
      knownMetadata: initialMetadata,
    });

    // Assert.
    expect(mockMetadataInfer).toBeCalledTimes(1);
    // It should have specified the file name.
    expect(mockMetadataInfer.mock.calls[0][1].name).toEqual(fileName);
    // It should have specified the size in the metadata.
    expect(mockMetadataInfer.mock.calls[0][3]).toEqual(imageData.size);

    // It should have inferred the metadata.
    expect(result).toEqual(expectedResponse);
  });

  it("can infer metadata from a video", async () => {
    // Arrange.
    // Fake a valid response.
    const expectedResponse = fakeVideoMetadata();
    const response: { [p in keyof UavVideoMetadata]: any } = expectedResponse;
    // In real server responses, the enum values come as raw strings.
    response.format = response.format.toString();
    response.platformType = response.platformType.toString();

    const mockMetadataInfer =
      mockVideosApiClass.prototype.inferVideoMetadataVideosMetadataInferPost;
    // @ts-ignore
    mockMetadataInfer.mockResolvedValue({ data: response });

    // This is sized to make it larger than the probe size.
    const videoSize = 5 * 2 * 2 ** 20;
    const videoData = new Blob([faker.datatype.string(videoSize)]);
    const initialMetadata = fakeVideoMetadata();

    const fileName = faker.system.fileName();

    // Act.
    const result = await inferVideoMetadata(videoData, {
      name: fileName,
      knownMetadata: initialMetadata,
    });

    // Assert.
    expect(mockMetadataInfer).toBeCalledTimes(1);
    // It should have specified the file name.
    expect(mockMetadataInfer.mock.calls[0][0].name).toEqual(fileName);
    // It should have only sent the first few MBs of the file.
    expect(mockMetadataInfer.mock.calls[0][0].size).toBeLessThan(videoSize);
    // It should have specified the size in the metadata.
    expect(mockMetadataInfer.mock.calls[0][2]).toEqual(videoData.size);

    // It should have inferred the metadata.
    expect(result).toEqual(expectedResponse);
  });

  it("handles a failure when inferring image metadata", async () => {
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
      inferImageMetadata(imageData, {
        name: faker.system.fileName(),
        knownMetadata: metadata,
      })
    ).rejects.toThrow(FakeAxiosError);

    // It should have logged the error information.
    expect(fakeError.toJSON).toBeCalledTimes(1);
  });

  it("handles a failure when inferring video metadata", async () => {
    // Arrange.
    // Make it look like inferring the metadata failed.
    const mockMetadataInfer =
      mockVideosApiClass.prototype.inferVideoMetadataVideosMetadataInferPost;
    const fakeError = new FakeAxiosError();
    mockMetadataInfer.mockRejectedValue(fakeError);

    const videoData = new Blob([faker.datatype.string()]);
    const metadata = fakeVideoMetadata();

    // Act and assert.
    await expect(
      inferVideoMetadata(videoData, {
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
      true,
      fakeImageMetadata(),
      ObjectType.IMAGE,
    ],
    [
      "image metadata, setting the names and sizes",
      false,
      false,
      false,
      fakeImageMetadata(),
      ObjectType.IMAGE,
    ],
    [
      "video metadata, ignoring length",
      false,
      false,
      true,
      fakeVideoMetadata(),
      ObjectType.VIDEO,
    ],
    [
      "video metadata, setting length",
      false,
      false,
      false,
      fakeVideoMetadata(),
      ObjectType.VIDEO,
    ],
  ]).it(
    "can update existing %s",
    async (
      _,
      ignoreName: boolean,
      ignoreSize: boolean,
      ignoreLength: boolean,
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
        ignoreSize,
        ignoreLength
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
      if (ignoreLength) {
        // We shouldn't have set the length parameters.
        const videoMetadata = expectedMetadata as UavVideoMetadata;
        if (
          videoMetadata.numFrames !== undefined ||
          videoMetadata.frameRate !== undefined
        ) {
          videoMetadata.numFrames = undefined;
          videoMetadata.frameRate = undefined;
        }
      }

      // It should have updated the metadata.
      const untypedIds = artifacts.map((a) => a.id);
      expect(mockUpdateMetadata).toBeCalledWith(
        objectType === ObjectType.IMAGE
          ? { metadata: expectedMetadata, images: untypedIds }
          : { metadata: expectedMetadata, videos: untypedIds },
        incrementSequence,
        undefined,
        { headers: { Authorization: expect.any(String) } }
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
  ]).it(
    "can get the URL for a(n) %s",
    async (_: string, objectType: ObjectType) => {
      // Arrange.
      const artifactId = fakeTypedObjectRef(objectType);

      // Act.
      const gotUrl = await getArtifactUrl(artifactId);

      // Assert.
      if (objectType === ObjectType.IMAGE) {
        expect(gotUrl).toContain("images");
      } else {
        expect(gotUrl).toContain("videos");
      }

      expect(gotUrl).toContain(`${artifactId.id.bucket}/${artifactId.id.name}`);
    }
  );

  each([
    ["image", ObjectType.IMAGE],
    ["video", ObjectType.VIDEO],
  ]).it(
    "can get the preview video URL for a(n) %s",
    async (_: string, objectType: ObjectType) => {
      // Arrange.
      const artifactId = fakeTypedObjectRef(objectType);

      // Act.
      const gotUrl = await getPreviewVideoUrl(artifactId);

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
    "can get the streamable video URL for a(n) %s",
    async (_: string, objectType: ObjectType) => {
      // Arrange.
      const artifactId = fakeTypedObjectRef(objectType);

      // Act.
      const gotUrl = await getStreamableVideoUrl(artifactId);

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
