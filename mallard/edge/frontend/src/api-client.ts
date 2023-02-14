import {
  Configuration,
  ImageFormat,
  ImagesApi,
  ObjectRef,
  Ordering,
  PlatformType,
  QueryResponse,
  UavImageMetadata,
} from "typescript-axios";
import { ImageQuery } from "./types";

// This global variable is expected to be pre-set by an external script.
declare const API_BASE_URL: string;

/** Singleton API client used by the entire application. */
const api = new ImagesApi(new Configuration({ basePath: API_BASE_URL }));

/** Used for translating raw platform types to enum values.
 * Must be kept in-sync with `PlatformType` on the backend.
 */
const PLATFORM_TYPE_TO_ENUM = new Map<string, PlatformType>([
  ["ground", PlatformType.GROUND],
  ["aerial", PlatformType.AERIAL],
]);

/** Used for translating raw image formats to enum values.
 * Must be kept in-sync with `ImageFormat` on the backend.
 */
const IMAGE_FORMAT_TO_ENUM = new Map<string, ImageFormat>([
  ["gif", ImageFormat.GIF],
  ["tiff", ImageFormat.TIFF],
  ["jpeg", ImageFormat.JPEG],
  ["bmp", ImageFormat.BMP],
  ["png", ImageFormat.PNG],
]);

/**
 * Converts a raw response from Axios to a metadata structure.
 * @param {UavImageMetadata} response The response to convert.
 * @return {UavImageMetadata} The equivalent metadata.
 */
function responseToMetadata(response: UavImageMetadata): UavImageMetadata {
  const rawResult = { ...response };

  // Fix the enums.
  rawResult.format = IMAGE_FORMAT_TO_ENUM.get(rawResult.format as string);
  rawResult.platformType = PLATFORM_TYPE_TO_ENUM.get(
    rawResult.platformType as string
  );

  return rawResult;
}

/**
 * Some functions require separate form parameters for input.
 * This function takes a metadata object, and breaks it down as
 * an array that can be spread to one of these functions.
 * @param {UavImageMetadata} metadata The metadata object.
 * @return {any[]} Array containing the metadata.
 */
function metadataToForm(metadata: UavImageMetadata): any[] {
  return [
    metadata.name,
    metadata.format,
    metadata.platformType,
    metadata.notes,
    metadata.sessionName,
    metadata.sequenceNumber,
    metadata.captureDate,
    metadata.camera,
    metadata.locationDescription,
    metadata.altitudeMeters,
    metadata.gsdCmPx,
    metadata.location?.latitudeDeg,
    metadata.location?.longitudeDeg,
  ];
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
  orderings: Ordering[] = [],
  resultsPerPage?: number,
  pageNum: number = 1
): Promise<QueryResponse> {
  const response = await api
    .queryImagesImagesQueryPost(resultsPerPage, pageNum, {
      queries: query,
      orderings: orderings,
    })
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
  const response = await api
    .getThumbnailImagesThumbnailBucketNameGet(imageId.bucket, imageId.name, {
      responseType: "blob",
    })
    .catch(function (error) {
      console.error(error.toJSON());
      throw error;
    });

  return response.data;
}

/**
 * Loads a specific image.
 * @param {ObjectRef} imageId The ID of the image to load.
 * @return {Blob} The raw image blob data.
 */
export async function loadImage(imageId: ObjectRef): Promise<Blob> {
  const response = await api
    .getImageImagesBucketNameGet(imageId.bucket, imageId.name, {
      responseType: "blob",
    })
    .catch(function (error) {
      console.error(error.toJSON());
      throw error;
    });

  return response.data;
}

/**
 * Loads metadata for an image.
 * @param {ObjectRef} imageId The ID of the image to load metadata for.
 * @return {UavImageMetadata} The image metadata.
 */
export async function getMetadata(
  imageId: ObjectRef
): Promise<UavImageMetadata> {
  const response = await api
    .getImageMetadataImagesMetadataBucketNameGet(imageId.bucket, imageId.name)
    .catch(function (error) {
      console.error(error.toJSON());
      throw error;
    });

  // Convert from JSON.
  return responseToMetadata(response.data);
}

/**
 * Uploads a new image.
 * @param {Blob} imageData The raw image data.
 * @param {UavImageMetadata} metadata The associated metadata for the image.
 * @return {ObjectRef} The ID of the new artifact that it created.
 */
export async function createImage(
  imageData: Blob,
  metadata: UavImageMetadata
): Promise<ObjectRef> {
  // Get the local timezone offset.
  const offset = new Date().getTimezoneOffset() / 60;
  const response = await api
    .createUavImageImagesCreateUavPost(
      offset,
      imageData,
      ...metadataToForm(metadata)
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
 * Infers metadata from a provided image.
 * @param {Blob} imageData The image to infer metadata from.
 * @param {UavImageMetadata} knownMetadata Any previously-known metadata.
 * @return {UavImageMetadata} The inferred metadata.
 */
export async function inferMetadata(
  imageData: Blob,
  knownMetadata: UavImageMetadata
): Promise<UavImageMetadata> {
  // Get the local timezone offset.
  const offset = new Date().getTimezoneOffset() / 60;

  const response = await api
    .inferImageMetadataImagesMetadataInferPost(
      offset,
      imageData,
      ...metadataToForm(knownMetadata)
    )
    .catch(function (error) {
      console.error(error.toJSON());
      throw error;
    });

  // Convert from JSON.
  return responseToMetadata(response.data);
}

/**
 * Updates the metadata for an entire set of images at once.
 * @param {UavImageMetadata} metadata The new metadata to set.
 * @param {ObjectRef[]} images The images to update.
 * @param {boolean} incrementSequence Whether to auto-increment sequence numbers
 *  for these image.
 */
export async function batchUpdateMetadata(
  metadata: UavImageMetadata,
  images: ObjectRef[],
  incrementSequence?: boolean
): Promise<void> {
  await api
    .batchUpdateMetadataImagesMetadataBatchUpdatePatch(
      {
        metadata: metadata,
        images: images,
      },
      incrementSequence
    )
    .catch(function (error) {
      console.error(error.toJSON());
      throw error;
    });
}
