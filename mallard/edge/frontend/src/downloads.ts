import { ObjectRef, UavImageMetadata } from "mallard-api";
import { downloadZip, InputWithMeta } from "client-zip";
import urlJoin from "url-join";
import streamSaver from "streamsaver";

// This global variable is expected to be pre-set by an external script.
declare const API_BASE_URL: string;

/**
 * Combines an image with associated metadata.
 */
export interface ImageWithMeta {
  id: ObjectRef;
  metadata: UavImageMetadata;
}

/**
 * Fetches a single image.
 * @param {ObjectRef} imageId The ID of the image.
 * @return {Response} The `Response` from fetching the image.
 */
async function fetchImage(imageId: ObjectRef): Promise<Response> {
  // We can't use the API client, unfortunately, because we need raw
  // `Response` objects.
  const imageUrl = urlJoin(
    API_BASE_URL,
    "images",
    imageId.bucket,
    imageId.name
  );
  return await fetch(imageUrl);
}

/**
 * Generator that fetches a series of images asynchronously.
 * @param {ObjectRef[]} images The info for the images to download.
 * @return {AsyncGenerator} A generator that yields `Response` objects from
 *  the image requests.
 */
async function* fetchImages(
  images: ImageWithMeta[]
): AsyncGenerator<InputWithMeta, void, void> {
  for (const image of images) {
    const imageResponse = await fetchImage(image.id);

    yield { name: image.metadata.name, input: imageResponse };
  }
}

/**
 * Initiates the download of a zip file containing images.
 * @param {ObjectRef[]} imageInfo The info for the images to download.
 * @return {Response} The response containing the downloaded zip file.
 */
function streamImages(imageInfo: ImageWithMeta[]): Response {
  // Get all the underlying images.
  const images = fetchImages(imageInfo);
  return downloadZip(images);
}

/**
 * Downloads a zip file containing the selected images.
 * @param {ObjectRef[]} images The info for the images to download.
 */
export async function downloadImageZip(images: ImageWithMeta[]): Promise<void> {
  const zipResponse = streamImages(images);

  // Save the file.
  const zipName = "artifacts.zip";
  let fileStream: WritableStream | null = null;
  try {
    // For browsers that support the FS Access API, use that.
    const fileHandle = await showSaveFilePicker({
      suggestedName: zipName,
      types: [
        { description: ".zip file", accept: { "application/zip": [".zip"] } },
      ],
    });
    fileStream = await fileHandle.createWritable();
  } catch {
    // Otherwise, fall back to StreamSaver.js.
    fileStream = streamSaver.createWriteStream(zipName);
  }

  // Abort when the user closes the page so we don't end up with a stuck
  // download.
  window.onunload = () => {
    /* istanbul ignore next */
    fileStream?.abort();
  };
  await zipResponse.body?.pipeTo(fileStream);
}
