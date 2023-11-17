import {
  TypedObjectRef,
  UavImageMetadata,
  UavVideoMetadata,
} from "mallard-api";
import { downloadZip, InputWithMeta, predictLength } from "client-zip";
import streamSaver from "streamsaver";
import { getArtifactUrl } from "./api-client";

/**
 * Combines an image with associated metadata.
 */
export interface ImageWithMeta {
  id: TypedObjectRef;
  metadata: UavImageMetadata | UavVideoMetadata;
}

/**
 * Fetches a single artifact.
 * @param {TypedObjectRef} artifactId The ID of the artifact.
 * @return {Response} The `Response` from fetching the artifact.
 */
async function fetchArtifact(artifactId: TypedObjectRef): Promise<Response> {
  // We can't use the API client, unfortunately, because we need raw
  // `Response` objects.
  return await fetch(await getArtifactUrl(artifactId));
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
  // Keeps track of how many times a particular name has been seen.
  const duplicateNames = new Map<string, number>();

  for (const image of images) {
    const imageResponse = await fetchArtifact(image.id);

    let name = image.metadata.name;
    if (name && duplicateNames.has(name)) {
      // This name is a duplicate. Make it unique so it doesn't mess up our
      // zip file.
      const originalName = name;
      name = `${duplicateNames.get(name)}_${name}`;
      duplicateNames.set(originalName, duplicateNames.get(originalName)! + 1);
    } else if (name) {
      duplicateNames.set(name, 1);
    }

    yield {
      name: name,
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
 * @param {ObjectRef[]} artifacts The info for the artifacts to download.
 */
export async function downloadArtifactZip(
  artifacts: ImageWithMeta[]
): Promise<void> {
  const zipLength = computeLength(artifacts);
  const zipResponse = streamImages(artifacts, zipLength);

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
 * @param {TypedObjectRef[]} artifactIds The list of image IDs.
 * @return {string} The link to the list of images. The user is responsible
 *  for calling `revokeObjectURL` when done with it.
 */
export async function makeArtifactUrlList(
  artifactIds: TypedObjectRef[]
): Promise<string> {
  // Get the image URLs.
  const imageUrlPromises = artifactIds.map(
    async (id) => `${await getArtifactUrl(id)} `
  );
  const imageUrls = await Promise.all(imageUrlPromises);

  // Create the list.
  const urlFile = new File(imageUrls, "image_urls.txt", { type: "text/plain" });
  return URL.createObjectURL(urlFile);
}
