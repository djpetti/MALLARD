import {
  Configuration,
  Field,
  ImageFormat,
  ImagesApi,
  ObjectRef,
  Ordering,
  PlatformType,
  QueryResponse,
  UavImageMetadata,
} from "mallard-api";
import { ImageQuery } from "./types";
import { cloneDeep } from "lodash";

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

/** Default orderings to use for queries. This will put the newest stuff at
 * the top, but sort by name for images collected on the same day.
 */
export const DEFAULT_ORDERINGS: Ordering[] = [
  { field: Field.CAPTURE_DATE, ascending: false },
  { field: Field.SESSION, ascending: true },
  { field: Field.NAME, ascending: true },
];

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
    metadata.size,
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
  orderings: Ordering[] = DEFAULT_ORDERINGS,
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
  // OpenAPI for some reason treats this as text instead of a blob by default.
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
 * @param {ObjectRef} imageIds The IDs of the images to load metadata for.
 * @return {UavImageMetadata[]} The corresponding metadata for each image.
 */
export async function getMetadata(
  imageIds: ObjectRef[]
): Promise<UavImageMetadata[]> {
  const response = await api
    .findImageMetadataImagesMetadataPost(imageIds)
    .catch(function (error) {
      console.error(error.toJSON());
      throw error;
    });

  // Convert from JSON.
  const metadata: UavImageMetadata[] = [];
  for (const rawMetadata of response.data.metadata) {
    metadata.push(responseToMetadata(rawMetadata));
  }
  return metadata;
}

/**
 * Uploads a new image.
 * @param {Blob} imageData The raw image data.
 * @param {string} name The name to use for the uploaded file.
 * @param {UavImageMetadata} metadata The associated metadata for the image.
 * @return {ObjectRef} The ID of the new artifact that it created.
 */
export async function createImage(
  imageData: Blob,
  { name, metadata }: { name: string; metadata: UavImageMetadata }
): Promise<ObjectRef> {
  // Get the local timezone offset.
  const offset = new Date().getTimezoneOffset() / 60;
  // Set the size based on the image to upload.
  metadata.size = imageData.size;

  const response = await api
    .createUavImageImagesCreateUavPost(
      offset,
      new File([imageData], name),
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
 * Deletes the specified images.
 * @param {ObjectRef[]} images The images to delete.
 */
export async function deleteImages(images: ObjectRef[]): Promise<void> {
  await api.deleteImagesImagesDeleteDelete(images).catch(function (error) {
    console.error(error.toJSON());
    throw error;
  });
}

/**
 * Infers metadata from a provided image.
 * @param {Blob} imageData The image to infer metadata from.
 * @param {name} The name to use for the image file.
 * @param {UavImageMetadata} knownMetadata Any previously-known metadata.
 * @return {UavImageMetadata} The inferred metadata.
 */
export async function inferMetadata(
  imageData: Blob,
  { name, knownMetadata }: { name: string; knownMetadata: UavImageMetadata }
): Promise<UavImageMetadata> {
  // Get the local timezone offset.
  const offset = new Date().getTimezoneOffset() / 60;
  // Set the size based on the image to upload.
  knownMetadata.size = imageData.size;

  const response = await api
    .inferImageMetadataImagesMetadataInferPost(
      offset,
      new File([imageData], name),
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
 * @param {boolean} ignoreName If true, it will not overwrite the name
 *  parameter of the individual artifacts.
 */
export async function batchUpdateMetadata(
  metadata: UavImageMetadata,
  images: ObjectRef[],
  incrementSequence?: boolean,
  ignoreName: boolean = true
): Promise<void> {
  // Copy to avoid surprising the user by modifying the argument.
  const metadataCopy = cloneDeep(metadata);
  if (ignoreName) {
    // Don't overwrite the names.
    metadataCopy.name = undefined;
  }

  await api
    .batchUpdateMetadataImagesMetadataBatchUpdatePatch(
      {
        metadata: metadataCopy,
        images: images,
      },
      incrementSequence
    )
    .catch(function (error) {
      console.error(error.toJSON());
      throw error;
    });
}
