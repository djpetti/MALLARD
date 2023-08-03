import {
  Configuration,
  Field,
  ImagesApi,
  DefaultApi,
  ObjectRef,
  Ordering,
  QueryResponse,
  UavImageMetadata,
  VideosApi,
  TypedObjectRef,
  ObjectType,
  UavVideoMetadata,
} from "mallard-api";
import { ImageQuery } from "./types";
import { cloneDeep } from "lodash";

// This global variable is expected to be pre-set by an external script.
declare const API_BASE_URL: string;

/** Singleton API client used by the entire application. */
const imagesApi = new ImagesApi(new Configuration({ basePath: API_BASE_URL }));
const videosApi = new VideosApi(new Configuration({ basePath: API_BASE_URL }));
const api = new DefaultApi(new Configuration({ basePath: API_BASE_URL }));

/** Default orderings to use for queries. This will put the newest stuff at
 * the top, but sort by name for images collected on the same day.
 */
export const DEFAULT_ORDERINGS: Ordering[] = [
  { field: Field.CAPTURE_DATE, ascending: false },
  { field: Field.SESSION, ascending: true },
  { field: Field.NAME, ascending: true },
];

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
    .queryArtifactsQueryPost(resultsPerPage, pageNum, {
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
    .getThumbnailThumbnailBucketNameGet(imageId.bucket, imageId.name, {
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
  const response = await imagesApi
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
 * @param {ObjectRef} artifactIds The IDs of the artifacts to load metadata for.
 * @return {UavImageMetadata[]} The corresponding metadata for each image.
 */
export async function getMetadata(
  artifactIds: TypedObjectRef[]
): Promise<(UavImageMetadata | UavVideoMetadata)[]> {
  const { imageIds, videoIds } = separateByType(artifactIds);

  const idsToMeta = new Map<ObjectRef, UavImageMetadata | UavVideoMetadata>();
  if (imageIds.length > 0) {
    const response = await imagesApi
      .findImageMetadataImagesMetadataPost(imageIds.map((e) => e.id))
      .catch(function (error) {
        console.error(error.toJSON());
        throw error;
      });
    response.data.metadata.forEach((m, i) => idsToMeta.set(imageIds[i].id, m));
  }
  if (videoIds.length > 0) {
    const response = await videosApi
      .findVideoMetadataVideosMetadataPost(videoIds.map((e) => e.id))
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

  const response = await imagesApi
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
  await imagesApi
    .deleteImagesImagesDeleteDelete(images)
    .catch(function (error) {
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

  const response = await imagesApi
    .inferImageMetadataImagesMetadataInferPost(
      offset,
      new File([imageData], name),
      ...metadataToForm(knownMetadata)
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
 */
export async function batchUpdateMetadata(
  metadata: UavImageMetadata | UavVideoMetadata,
  artifacts: TypedObjectRef[],
  incrementSequence?: boolean,
  ignoreName: boolean = true,
  ignoreSize: boolean = true
): Promise<void> {
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

  const { imageIds, videoIds } = separateByType(artifacts);

  if (imageIds.length > 0) {
    await imagesApi
      .batchUpdateMetadataImagesMetadataBatchUpdatePatch(
        {
          metadata: metadataCopy as UavImageMetadata,
          images: imageIds.map((e) => e.id),
        },
        incrementSequence
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
        incrementSequence
      )
      .catch(function (error) {
        console.error(error.toJSON());
        throw error;
      });
  }
}
