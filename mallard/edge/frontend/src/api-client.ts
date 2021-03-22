import { Configuration, ImagesApi } from "typescript-axios";
import { ArtifactId, ImageMetadata, ImageQuery, QueryResult } from "./types";

/** Singleton API client used by the entire application. */
const api = new ImagesApi(new Configuration(), "http://localhost:8000");

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
  return {
    captureDate: response.data["capture_date"],
  };
}
