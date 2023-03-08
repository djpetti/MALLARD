import { ObjectRef } from "mallard-api";
import { downloadZip, InputWithMeta } from "client-zip";
import { showSaveFilePicker } from "native-file-system-adapter";

// This global variable is expected to be pre-set by an external script.
declare const API_BASE_URL: string;

// /** Maps MIME types to file extensions. */
// const MIME_TO_EXT = new Map<string, string>([
//   ["image/gif", "gif"],
//   ["image/tiff", "tiff"],
//   ["image/jpeg", "jpg"],
//   ["image/bmp", "bmp"],
//   ["image/png", "png"],
// ]);

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

/**
 * Generator that fetches a series of images asynchronously.
 * @param {ObjectRef[]} imageIds The IDs of the images to fetch.
 * @return {AsyncGenerator} A generator that yields `Response` objects from
 *  the image requests.
 */
async function* fetchImages(
  imageIds: ObjectRef[]
): AsyncGenerator<InputWithMeta, void, void> {
  for (const imageId of imageIds) {
    yield await fetchImage(imageId);
  }
}

/**
 * Initiates the download of a zip file containing images.
 * @param {ObjectRef[]} imageIds The IDs of the images to download.
 * @return {Response} The response containing the downloaded zip file.
 */
function streamImages(imageIds: ObjectRef[]): Response {
  // Get all the underlying images.
  const images = fetchImages(imageIds);
  return downloadZip(images);
}

/**
 * Downloads a zip file containing the selected images.
 * @param {ObjectRef[]} imageIds The IDs of the images to download.
 */
export async function downloadImageZip(imageIds: ObjectRef[]): Promise<void> {
  // Allow the user to select a place to save the file.
  const fileHandle = await showSaveFilePicker({
    _preferPolyfill: false,
    suggestedName: "artifacts.zip",
    excludeAcceptAllOption: false,
  });

  const zipResponse = streamImages(imageIds);

  // Save the file.
  await zipResponse.body?.pipeTo(await fileHandle.createWritable());
}
