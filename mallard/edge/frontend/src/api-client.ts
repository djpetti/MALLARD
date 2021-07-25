import { Configuration, ImagesApi } from "typescript-axios";
import { ArtifactId, ImageMetadata, ImageQuery, QueryResult } from "./types";

/** Singleton API client used by the entire application. */
const api = new ImagesApi(
  new Configuration({ basePath: "http://localhost:8081/api/v1" })
);

/**
 * Converts a raw response from Axios to a metadata structure.
 * @param {any} response The response to convert.
 * @return {ImageMetadata} The equivalent metadata.
 */
function responseToMetadata(response: any): ImageMetadata {
  const rawResult = response.data;
  return {
    name: rawResult.name,
    format: rawResult.format,
    platformType: rawResult.platform_type,
    notes: rawResult.notes,
    sessionNumber: rawResult.session_number,
    sequenceNumber: rawResult.sequence_number,
    captureDate: rawResult.capture_date,
    camera: rawResult.camera,
    location: {
      latitudeDeg: rawResult.latitude_deg,
      longitudeDeg: rawResult.longitude_deg,
    },
    locationDescription: rawResult.location_description,
    altitudeMeters: rawResult.altitude_meters,
    gsdCmPx: rawResult.gsd_cm_px,
  };
}

/**
 * Performs a query for images.
 * @param {ImageQuery} query The query to perform.
 * @return {QueryResult} The result of the query.
 */
export async function queryImages(query: ImageQuery): Promise<QueryResult> {
  const response = await api
    .queryImagesImagesQueryPost(50, 1, query)
    .catch(function (error) {
      console.error(error.toJSON());
      throw error;
    });

  const rawResult = response.data;
  return {
    imageIds: rawResult.image_ids,
    pageNum: rawResult.page_num,
    isLastPage: rawResult.is_last_page,
  };
}

/**
 * Loads a specific thumbnail.
 * @param {ArtifactId} imageId The ID of the image to load the thumbnail for.
 * @return {string} The raw thumbnail image blob data.
 */
export async function loadThumbnail(imageId: ArtifactId): Promise<string> {
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
 * Loads metadata for an image.
 * @param {ArtifactId} imageId The ID of the image to load metadata for.
 * @return {ImageMetadata} The image metadata.
 */
export async function getMetadata(imageId: ArtifactId): Promise<ImageMetadata> {
  const response = await api
    .getImageMetadataImagesMetadataBucketNameGet(imageId.bucket, imageId.name)
    .catch(function (error) {
      console.error(error.toJSON());
      throw error;
    });

  // Convert from JSON.
  return responseToMetadata(response);
}

/**
 * Uploads a new image.
 * @param {Blob} imageData The raw image data.
 * @param {ImageMetadata} metadata The associated metadata for the image.
 * @return {ArtifactId} The ID of the new artifact that it created.
 */
export async function createImage(
  imageData: Blob,
  metadata: ImageMetadata
): Promise<ArtifactId> {
  // Get the local timezone offset.
  const offset = new Date().getTimezoneOffset() / 60;
  const response = await api
    .createUavImageImagesCreateUavPost(offset, imageData, metadata.name)
    .catch(function (error) {
      console.error(error.toJSON());
      throw error;
    });

  // Convert from JSON.
  return {
    bucket: response.data.image_id.bucket,
    name: response.data.image_id.name,
  };
}

/**
 * Infers metadata from a provided image.
 * @param {Blob} imageData The image to infer metadata from.
 * @param {ImageMetadata} knownMetadata Any previously-known metadata.
 * @return {ImageMetadata} The inferred metadata.
 */
export async function inferMetadata(
  imageData: Blob,
  knownMetadata: ImageMetadata
): Promise<ImageMetadata> {
  // Get the local timezone offset.
  const offset = new Date().getTimezoneOffset() / 60;

  const response = await api
    .inferImageMetadataImagesMetadataInferPost(
      offset,
      imageData,
      knownMetadata.name
    )
    .catch(function (error) {
      console.error(error.toJSON());
      throw error;
    });

  // Convert from JSON.
  return responseToMetadata(response);
}
