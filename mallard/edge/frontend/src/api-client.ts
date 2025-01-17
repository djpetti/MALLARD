import {
  Configuration,
  DefaultApi,
  Field,
  ImagesApi,
  ObjectRef,
  ObjectType,
  Ordering,
  QueryResponse,
  TypedObjectRef,
  UavImageMetadata,
  UavVideoMetadata,
  VideosApi,
} from "mallard-api";
import { ImageQuery } from "./types";
import { cloneDeep } from "lodash";
import urlJoin from "url-join";
import { AxiosRequestConfig, AxiosRequestHeaders } from "axios";
import {
  Fief,
  browser,
  FiefTokenResponse,
  FiefAccessTokenExpired,
  FiefAccessTokenInvalid,
  FiefAccessTokenMissingScope,
  FiefUserInfo,
} from "@fief/fief";

// These global variables are expected to be pre-set by an external script.
// Base URL for the MALLARD API.
declare const API_BASE_URL: string;
// Whether Fief authentication is enabled.
declare const AUTH_ENABLED: boolean;
// Base URL for Fief authentication.
declare const AUTH_BASE_URL: string;
// Client ID for Fief authentication.
declare const AUTH_CLIENT_ID: string;

// How many bytes from the beginning of the video we send when probing.
const PROBE_SIZE = 5 * 2 ** 20;

/** Singleton API client used by the entire application. */
const imagesApi = new ImagesApi(new Configuration({ basePath: API_BASE_URL }));
const videosApi = new VideosApi(new Configuration({ basePath: API_BASE_URL }));
const api = new DefaultApi(new Configuration({ basePath: API_BASE_URL }));

/** Singleton Fief client used by the entire application. */
const fiefClient = AUTH_ENABLED
  ? new Fief({
      baseURL: AUTH_BASE_URL,
      clientId: AUTH_CLIENT_ID,
    })
  : undefined;
const fiefAuth = AUTH_ENABLED
  ? new browser.FiefAuth(fiefClient as Fief)
  : undefined;

/** Default orderings to use for queries. This will put the newest stuff at
 * the top, but sort by name for images collected on the same day.
 */
export const DEFAULT_ORDERINGS: Ordering[] = [
  { field: Field.CAPTURE_DATE, ascending: false },
  { field: Field.SESSION, ascending: true },
  { field: Field.NAME, ascending: true },
];

/**
 * Checks that the user is authenticated, and forces them to log in
 * if they aren't.
 */
async function ensureAuthenticated(): Promise<void> {
  if (!fiefAuth) {
    // Authentication is not enabled.
    // istanbul ignore next
    return;
  }

  // Use a lock here so that it doesn't try to authenticate multiple times
  // concurrently in concurrent requests.
  await navigator.locks.request("auth", async (_) => {
    const location = window.location.href;

    let authValid = false;
    if (fiefAuth.isAuthenticated()) {
      // Check that the saved token is actually valid.
      const tokenInfo = fiefAuth.getTokenInfo() as FiefTokenResponse;
      try {
        await fiefClient?.validateAccessToken(tokenInfo.access_token);
        // If we get here, this token is valid.
        authValid = true;
      } catch (err) {
        if (
          err! instanceof FiefAccessTokenExpired &&
          err! instanceof FiefAccessTokenInvalid &&
          err! instanceof FiefAccessTokenMissingScope
        ) {
          // istanbul ignore next
          throw err;
        }
      }
    }

    if (!authValid) {
      // Save this so we can retrieve it in the callback.
      window.localStorage.setItem("pre_auth_location", location);

      // Force the user to log in.
      const rootLocation = new URL(location);
      rootLocation.pathname = "/";

      await fiefAuth.redirectToLogin(
        new URL("/auth_callback", rootLocation.href).href
      );
    }
  });
}

/**
 * Gets the current authentication token.
 * @return {string} The authentication token or undefined if auth is not
 *  enabled, or it failed.
 */
async function getAuthToken(): Promise<string | undefined> {
  if (!AUTH_ENABLED) {
    // Authentication is not enabled. There is no token.
    // istanbul ignore next
    return undefined;
  }

  await ensureAuthenticated();

  const tokenInfo = (fiefAuth as browser.FiefAuth).getTokenInfo();
  return tokenInfo?.access_token;
}

/**
 * Gets the correct headers to use for authentication.
 * @return {AxiosRequestHeaders} The authentication headers.
 */
async function getAuthHeaders(): Promise<AxiosRequestHeaders> {
  const accessToken = await getAuthToken();
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

/**
 * Gets the query string to use for authentication.
 * @return {string} The query string.
 */
async function getAuthQueryString(): Promise<string> {
  const accessToken = await getAuthToken();
  return accessToken ? `auth_token=${accessToken}` : "";
}

/**
 * Generates the common metadata elements from `imageMetadataToForm` and
 * `videoMetadataToForm`.
 * @param {UavImageMetadata | UavVideoMetadata} metadata The metadata object.
 * @return {any[]} Array containing the metadata.
 */
function commonMetadataToForm(
  metadata: UavImageMetadata | UavVideoMetadata
): any[] {
  return [
    metadata.size,
    metadata.name,
    metadata.platformType,
    metadata.notes,
    metadata.sessionName,
    metadata.sequenceNumber,
    metadata.captureDate,
    metadata.locationDescription,
    metadata.camera,
    metadata.altitudeMeters,
    metadata.gsdCmPx,
    metadata.format,
  ];
}

/**
 * Some functions require separate form parameters for input.
 * This function takes an image metadata object, and breaks it down as
 * an array that can be spread to one of these functions.
 * @param {UavImageMetadata} metadata The metadata object.
 * @return {any[]} Array containing the metadata.
 */
function imageMetadataToForm(metadata: UavImageMetadata): any[] {
  return commonMetadataToForm(metadata).concat([
    metadata.location?.latitudeDeg,
    metadata.location?.longitudeDeg,
  ]);
}

/**
 * Some functions require separate form parameters for input.
 * This function takes a video metadata object, and breaks it down as
 * an array that can be spread to one of these functions.
 * @param {UavImageMetadata} metadata The metadata object.
 * @return {any[]} Array containing the metadata.
 */
function videoMetadataToForm(metadata: UavVideoMetadata): any[] {
  return commonMetadataToForm(metadata).concat([
    metadata.frameRate,
    metadata.numFrames,
    metadata.location?.latitudeDeg,
    metadata.location?.longitudeDeg,
  ]);
}

/**
 * Separates a set of artifact IDs by the type of artifact.
 * @param {TypedObjectRef[]} artifactIds The artifact Ids.
 * @return {unknown} The image and video artifact IDs.
 */
function separateByType(artifactIds: TypedObjectRef[]): {
  imageIds: TypedObjectRef[];
  videoIds: TypedObjectRef[];
} {
  return {
    imageIds: artifactIds.filter((e) => e.type === ObjectType.IMAGE),
    videoIds: artifactIds.filter((e) => e.type === ObjectType.VIDEO),
  };
}

/**
 * Gets the current user info.
 * @return {FiefUserInfo | null} The user information, or null if a user
 *  is not logged in.
 */
export function getUserInfo(): FiefUserInfo | null {
  if (fiefAuth === undefined) {
    // Authentication is disabled.
    // istanbul ignore next
    return null;
  }
  return (fiefAuth as browser.FiefAuth).getUserinfo();
}

/**
 * Gets the profile URL for the user.
 * @return {string} The profile URL.
 */
export function getUserProfileUrl(): string {
  // Going here shows the profile.
  return AUTH_BASE_URL;
}

/**
 * Will force the user to logout, and return them to the same page.
 */
export function logout() {
  if (!fiefAuth) {
    // Authentication is disabled.
    // istanbul ignore next
    return;
  }

  fiefAuth.logout(window.location.href).then();
}

/**
 * Performs a query for images.
 * @param {ImageQuery} query The query to perform.
 * @param {Ordering[]} orderings The orderings to use for the query results.
 * @param {number} resultsPerPage The number of results to include on each page.
 * @param {number} pageNum The page number to fetch.
 * @return {QueryResponse} The result of the query.
 */
export async function queryImages(
  query: ImageQuery[],
  orderings: Ordering[] = DEFAULT_ORDERINGS,
  resultsPerPage?: number,
  pageNum: number = 1
): Promise<QueryResponse> {
  const authHeaders = await getAuthHeaders();

  const response = await api
    .queryArtifactsQueryPost(
      resultsPerPage,
      pageNum,
      undefined,
      {
        queries: query,
        orderings: orderings,
      },
      { headers: authHeaders }
    )
    .catch(function (error) {
      console.error(error.toJSON());
      throw error;
    });
  return response.data;
}

/**
 * Loads a specific thumbnail.
 * @param {ObjectRef} imageId The ID of the image to load the thumbnail for.
 * @return {Blob} The raw thumbnail image blob data.
 */
export async function loadThumbnail(imageId: ObjectRef): Promise<Blob> {
  const authHeaders = await getAuthHeaders();

  const response = await api
    .getThumbnailThumbnailBucketNameGet(
      imageId.bucket,
      imageId.name,
      undefined,
      {
        responseType: "blob",
        headers: authHeaders,
      }
    )
    .catch(function (error) {
      console.error(error.toJSON());
      throw error;
    });
  // OpenAPI for some reason treats this as text instead of a blob by default.
  return response.data;
}

/**
 * Loads a specific image.
 * @param {ObjectRef} imageId The ID of the image to load.
 * @return {Blob} The raw image blob data.
 */
export async function loadImage(imageId: ObjectRef): Promise<Blob> {
  const authHeaders = await getAuthHeaders();

  const response = await imagesApi
    .getImageImagesBucketNameGet(imageId.bucket, imageId.name, undefined, {
      responseType: "blob",
      headers: authHeaders,
    })
    .catch(function (error) {
      console.error(error.toJSON());
      throw error;
    });

  return response.data;
}

/**
 * Loads metadata for an image.
 * @param {ObjectRef} artifactIds The IDs of the artifacts to load metadata for.
 * @return {UavImageMetadata[]} The corresponding metadata for each image.
 */
export async function getMetadata(
  artifactIds: TypedObjectRef[]
): Promise<(UavImageMetadata | UavVideoMetadata)[]> {
  const authHeaders = await getAuthHeaders();

  const { imageIds, videoIds } = separateByType(artifactIds);

  const idsToMeta = new Map<ObjectRef, UavImageMetadata | UavVideoMetadata>();
  if (imageIds.length > 0) {
    const response = await imagesApi
      .findImageMetadataImagesMetadataPost(
        imageIds.map((e) => e.id),
        undefined,
        { headers: authHeaders }
      )
      .catch(function (error) {
        console.error(error.toJSON());
        throw error;
      });
    response.data.metadata.forEach((m, i) => idsToMeta.set(imageIds[i].id, m));
  }
  if (videoIds.length > 0) {
    const response = await videosApi
      .findVideoMetadataVideosMetadataPost(
        videoIds.map((e) => e.id),
        undefined,
        { headers: authHeaders }
      )
      .catch(function (error) {
        console.error(error.toJSON());
        throw error;
      });
    response.data.metadata.forEach((m, i) => idsToMeta.set(videoIds[i].id, m));
  }

  // Return metadata in the same order as the input.
  return artifactIds.map(
    (o) => idsToMeta.get(o.id) as UavImageMetadata | UavVideoMetadata
  );
}

/**
 * Uploads a new image.
 * @param {Blob} imageData The raw image data.
 * @param {string} name The name to use for the uploaded file.
 * @param {function} onProgress A callback to run
 *  whenever the upload progresses.
 * @return {ObjectRef} The ID of the new artifact that it created.
 */
export async function createImage(
  imageData: Blob,
  { name, metadata }: { name: string; metadata: UavImageMetadata },
  onProgress?: (percentDone: number) => void
): Promise<ObjectRef> {
  const authHeaders = await getAuthHeaders();

  // Get the local timezone offset.
  const offset = new Date().getTimezoneOffset() / 60;
  // Set the size based on the image to upload.
  metadata.size = imageData.size;

  const config: AxiosRequestConfig = { headers: authHeaders };
  if (onProgress !== undefined) {
    config.onUploadProgress = (progressEvent: ProgressEvent) => {
      onProgress((progressEvent.loaded / progressEvent.total) * 100);
    };
  }

  const response = await imagesApi
    .createUavImageImagesCreateUavPost(
      offset,
      new File([imageData], name),
      undefined,
      ...imageMetadataToForm(metadata).concat(config)
    )
    .catch(function (error) {
      console.error(error.toJSON());
      throw error;
    });

  // Convert from JSON.
  return {
    bucket: response.data.imageId.bucket,
    name: response.data.imageId.name,
  };
}

/**
 * Uploads a new video.
 * @param {Blob} videoData The raw image data.
 * @param {string} name The name to use for the uploaded file.
 * @param {function} onProgress A callback to run
 *  whenever the upload progresses.
 * @return {ObjectRef} The ID of the new artifact that it created.
 */
export async function createVideo(
  videoData: Blob,
  { name, metadata }: { name: string; metadata: UavVideoMetadata },
  onProgress?: (percentDone: number) => void
): Promise<ObjectRef> {
  const authHeaders = await getAuthHeaders();

  // Set the size based on the image to upload.
  metadata.size = videoData.size;

  const config: AxiosRequestConfig = {
    timeout: 30 * 60 * 1000,
    headers: authHeaders,
  };
  if (onProgress !== undefined) {
    config.onUploadProgress = (progressEvent: ProgressEvent) => {
      onProgress((progressEvent.loaded / progressEvent.total) * 100);
    };
  }

  const response = await videosApi
    .createUavVideoVideosCreateUavPost(
      new File([videoData], name),
      undefined,
      ...videoMetadataToForm(metadata).concat(config)
    )
    .catch(function (error) {
      console.error(error.toJSON());
      throw error;
    });

  // Convert from JSON.
  return {
    bucket: response.data.videoId.bucket,
    name: response.data.videoId.name,
  };
}

/**
 * Deletes the specified images.
 * @param {ObjectRef[]} images The images to delete.
 */
export async function deleteImages(images: ObjectRef[]): Promise<void> {
  const authHeaders = await getAuthHeaders();

  await imagesApi
    .deleteImagesImagesDeleteDelete(images, undefined, { headers: authHeaders })
    .catch(function (error) {
      console.error(error.toJSON());
      throw error;
    });
}

/**
 * Infers metadata from a provided image.
 * @param {Blob} imageData The image to infer metadata from.
 * @param {string} name The name to use for the image file.
 * @param {UavImageMetadata} knownMetadata Any previously-known metadata.
 * @return {UavImageMetadata} The inferred metadata.
 */
export async function inferImageMetadata(
  imageData: Blob,
  { name, knownMetadata }: { name: string; knownMetadata: UavImageMetadata }
): Promise<UavImageMetadata> {
  const authHeaders = await getAuthHeaders();

  // Get the local timezone offset.
  const offset = new Date().getTimezoneOffset() / 60;
  // Set the size based on the image to upload.
  knownMetadata.size = imageData.size;

  const response = await imagesApi
    .inferImageMetadataImagesMetadataInferPost(
      offset,
      new File([imageData], name),
      undefined,
      ...imageMetadataToForm(knownMetadata).concat({ headers: authHeaders })
    )
    .catch(function (error) {
      console.error(error.toJSON());
      throw error;
    });

  return response.data;
}

/**
 * Infers metadata from a provided video.
 * @param {Blob} videoData The video to infer metadata from.
 * @param {string} name The name to use for the video file.
 * @param {UavImageMetadata} knownMetadata Any previously-known metadata.
 * @return {UavImageMetadata} The inferred metadata.
 */
export async function inferVideoMetadata(
  videoData: Blob,
  { name, knownMetadata }: { name: string; knownMetadata: UavVideoMetadata }
): Promise<UavVideoMetadata> {
  const authHeaders = await getAuthHeaders();

  // Set the size based on the image to upload.
  knownMetadata.size = videoData.size;
  // For probing, we only need the first few MBs.
  videoData = videoData.slice(0, PROBE_SIZE);

  const response = await videosApi
    .inferVideoMetadataVideosMetadataInferPost(
      new File([videoData], name),
      undefined,
      ...videoMetadataToForm(knownMetadata).concat({ headers: authHeaders })
    )
    .catch(function (error) {
      console.error(error.toJSON());
      throw error;
    });

  return response.data;
}

/**
 * Updates the metadata for an entire set of images at once.
 * @param {UavImageMetadata} metadata The new metadata to set.
 * @param {ObjectRef[]} artifacts The images to update.
 * @param {boolean} incrementSequence Whether to auto-increment sequence numbers
 *  for these image.
 * @param {boolean} ignoreName If true, it will not overwrite the name
 *  parameter of the individual artifacts.
 * @param {boolean} ignoreSize If true, it will not overwrite the size
 *  parameter of the individual artifacts.
 * @param {boolean} ignoreLength If true, it will not overwrite the
 *  number of frames and FPS parameters for videos.
 */
export async function batchUpdateMetadata(
  metadata: UavImageMetadata | UavVideoMetadata,
  artifacts: TypedObjectRef[],
  incrementSequence?: boolean,
  ignoreName: boolean = true,
  ignoreSize: boolean = true,
  ignoreLength: boolean = true
): Promise<void> {
  const authHeaders = await getAuthHeaders();

  // Copy to avoid surprising the user by modifying the argument.
  const metadataCopy = cloneDeep(metadata);
  if (ignoreName) {
    // Don't overwrite the names.
    metadataCopy.name = undefined;
  }
  if (ignoreSize) {
    // Don't overwrite the sizes.
    metadataCopy.size = undefined;
  }
  if (ignoreLength) {
    // Don't overwrite video length parameters.
    const videoMetadata = metadataCopy as UavVideoMetadata;
    if (
      videoMetadata.numFrames !== undefined ||
      videoMetadata.frameRate !== undefined
    ) {
      videoMetadata.numFrames = undefined;
      videoMetadata.frameRate = undefined;
    }
  }

  const { imageIds, videoIds } = separateByType(artifacts);

  if (imageIds.length > 0) {
    await imagesApi
      .batchUpdateMetadataImagesMetadataBatchUpdatePatch(
        {
          metadata: metadataCopy as UavImageMetadata,
          images: imageIds.map((e) => e.id),
        },
        incrementSequence,
        undefined,
        { headers: authHeaders }
      )
      .catch(function (error) {
        console.error(error.toJSON());
        throw error;
      });
  }
  if (videoIds.length > 0) {
    await videosApi
      .batchUpdateMetadataVideosMetadataBatchUpdatePatch(
        {
          metadata: metadataCopy as UavVideoMetadata,
          videos: videoIds.map((e) => e.id),
        },
        incrementSequence,
        undefined,
        { headers: authHeaders }
      )
      .catch(function (error) {
        console.error(error.toJSON());
        throw error;
      });
  }
}

/**
 * Gets the URL for an artifact.
 * @param {TypedObjectRef} artifactId The ID of the artifact.
 * @return {string} The artifact URL.
 */
export async function getArtifactUrl(
  artifactId: TypedObjectRef
): Promise<string> {
  const router = artifactId.type == ObjectType.IMAGE ? "images" : "videos";
  return urlJoin(
    API_BASE_URL,
    router,
    artifactId.id.bucket,
    `${artifactId.id.name}?${await getAuthQueryString()}`
  );
}

/**
 * Gets the URL for a preview of an artifact.
 * @param {TypedObjectRef} artifactId The ID of the artifact.
 * @return {string | null} The preview URL, or undefined if the
 *   artifact is not a video.
 */
export async function getPreviewVideoUrl(
  artifactId: TypedObjectRef
): Promise<string | null> {
  if (artifactId.type !== ObjectType.VIDEO) {
    // Previews are only available for videos.
    return null;
  }

  return urlJoin(
    API_BASE_URL,
    "videos",
    "preview",
    artifactId.id.bucket,
    `${artifactId.id.name}?${await getAuthQueryString()}`
  );
}

/**
 * Gets the URL for the streamable version of an artifact.
 * @param {TypedObjectRef} artifactId The ID of the artifact.
 * @return {string | null} The streaming URL, or undefined if the
 *   artifact is not a video.
 */
export async function getStreamableVideoUrl(
  artifactId: TypedObjectRef
): Promise<string | null> {
  if (artifactId.type !== ObjectType.VIDEO) {
    // Previews are only available for videos.
    return null;
  }

  return urlJoin(
    API_BASE_URL,
    "videos",
    "stream",
    artifactId.id.bucket,
    `${artifactId.id.name}?${await getAuthQueryString()}`
  );
}
