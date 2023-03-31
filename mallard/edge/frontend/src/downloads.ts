import { ObjectRef, UavImageMetadata } from "mallard-api";
import { downloadZip, InputWithMeta, predictLength } from "client-zip";
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
 * Gets the URL for an image.
 * @param {ObjectRef} imageId The ID of the image.
 * @return {string} The image URL.
 */
function getImageUrl(imageId: ObjectRef): string {
  return urlJoin(API_BASE_URL, "images", imageId.bucket, imageId.name);
}

/**
 * Fetches a single image.
 * @param {ObjectRef} imageId The ID of the image.
 * @return {Response} The `Response` from fetching the image.
 */
async function fetchImage(imageId: ObjectRef): Promise<Response> {
  // We can't use the API client, unfortunately, because we need raw
  // `Response` objects.
  return await fetch(getImageUrl(imageId));
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

    yield {
      name: image.metadata.name,
      lastModified: image.metadata.captureDate,
      input: imageResponse,
    };
  }
}

/**
 * Pre-computes the size of the zip file.
 * @param {ImageWithMeta} images The info for the images to download.
 * @return {bigint} The size of the zip file.
 */
function computeLength(images: ImageWithMeta[]): bigint {
  const metadata = images.map((i) => ({
    name: i.metadata.name,
    size: BigInt(i.metadata.size ?? 0),
  }));
  return predictLength(metadata);
}

/**
 * Initiates the download of a zip file containing images.
 * @param {ObjectRef[]} imageInfo The info for the images to download.
 * @param {bigint} length The predicted length of the zip file.
 * @return {Response} The response containing the downloaded zip file.
 */
function streamImages(imageInfo: ImageWithMeta[], length: bigint): Response {
  // Get all the underlying images.
  const images = fetchImages(imageInfo);
  return downloadZip(images, { length: length });
}

/**
 * Downloads a zip file containing the selected images.
 * @param {ObjectRef[]} images The info for the images to download.
 */
export async function downloadImageZip(images: ImageWithMeta[]): Promise<void> {
  const zipLength = computeLength(images);
  const zipResponse = streamImages(images, zipLength);

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
    fileStream = streamSaver.createWriteStream(zipName, {
      // It's not typed to accept bigints, but it doesn't seem to care
      // when you pass them.
      size: zipLength as unknown as number,
    });
  }

  // Abort when the user closes the page so we don't end up with a stuck
  // download.
  window.onunload = () => {
    /* istanbul ignore next */
    fileStream?.abort();
  };
  await zipResponse.body?.pipeTo(fileStream);
}

/**
 * Creates a file containing a list of the URLs for the specified images,
 * and provides the user a link to it.
 * @param {ObjectRef[]} imageIds The list of image IDs.
 * @return {string} The link to the list of images. The user is responsible
 *  for calling `revokeObjectURL` when done with it.
 */
export function makeImageUrlList(imageIds: ObjectRef[]): string {
  // Get the image URLs.
  const imageUrls = imageIds.map((id) => `${getImageUrl(id)}\n`);

  // Create the list.
  const urlFile = new File(imageUrls, "image_urls.txt", { type: "text/plain" });
  return URL.createObjectURL(urlFile);
}
