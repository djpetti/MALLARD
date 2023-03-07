import { ObjectRef } from "mallard-api";

// This global variable is expected to be pre-set by an external script.
declare const API_BASE_URL: string;

/**
 * Fetches a single image.
 * @param {ObjectRef} imageId The ID of the image.
 * @return {Response} The `Response` from fetching the image.
 */
async function fetchImage(imageId: ObjectRef): Promise<Response> {
  // We can't use the API client, unfortunately, because we need raw
  // `Response` objects.
  const imageUrl = new URL(
    `images/${imageId.bucket}/${imageId.name}`,
    API_BASE_URL
  );
  return await fetch(imageUrl);
}

async function streamImages(imageIds: ObjectRef[]): Promise<Response> {
  // Get all the underlying images.
}
