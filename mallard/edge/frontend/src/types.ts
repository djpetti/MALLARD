import { Dictionary, EntityId } from "@reduxjs/toolkit";

/**
 * Represents the state of a long-running request.
 */
export enum RequestState {
  IDLE = "idle",
  LOADING = "loading",
  SUCCEEDED = "succeeded",
  FAILED = "failed",
}

/**
 * Represents a particular artifact in MALLARD.
 */
export interface ArtifactId {
  /** The bucket name for this artifact. */
  bucket: string;
  /** The unique ID for this artifact within the bucket. */
  name: string;
}

/**
 * Represents a query for images.
 *
 * Note that this class does not necessarily follow naming rules because it
 * is meant to mirror the `ImageQuery` structure from the API.
 *
 * Also note that not all query parameters supported by the API are
 * currently supported here. They will be added as they are needed.
 */
export interface ImageQuery {}

/**
 * Represents (possibly incomplete) results from a query.
 */
export interface QueryResult {
  /** The image IDs that were returned by this query. */
  imageIds: ArtifactId[];
  /** The most recent page number that we have queried. */
  pageNum: number;
  /** Whether this is the last page of query results. */
  isLastPage: boolean;
}

/**
 * Represents image metadata as received from the backend.
 */
export interface BackendImageMetadata {
  /** The date that the image was captured on. This is in raw string
   * form to please Redux, but should be trivially convertible to a Date object.
   */
  captureDate: string;
}

/**
 * Represents image metadata as sent to the backend. This is slightly
 * different from the backend version, as it allows for certain parameters
 * to be inferred automatically by the backend. It also allows for some
 * parameters to be in a format more convenient to the frontend.
 */
export interface FrontendImageMetadata {
  /** The name of the image. */
  name: string | null;
}

/**
 * Generic interface for a normalized table.
 */
interface NormalizedState<EntityType> {
  /** The sorted IDs in the table. */
  ids: EntityId[];
  /** The actual table data, mapping IDs to EntityTypes. */
  entities: Dictionary<EntityType>;
}

/**
 * The loading status of the thumbnail images.
 */
export enum ThumbnailStatus {
  /** Thumbnail is loading. */
  LOADING,
  /** Thumbnail is loaded and displayed. */
  VISIBLE,
}

/**
 * The entry in the normalized table for image data.
 */
export interface ImageEntity {
  /** Unique ID for the image provided by the backend. */
  backendId: ArtifactId;
  /** Status of loading the image thumbnail. */
  status: ThumbnailStatus;
  /** The object URL of the image. */
  imageUrl: string | null;
  /** The metadata associated with the image. */
  metadata: BackendImageMetadata | null;
}

/**
 * Represents the state of the thumbnail grid.
 */
export interface ThumbnailGridState extends NormalizedState<ImageEntity> {
  /** Most recent query results. */
  lastQueryResults: QueryResult | null;
  /** Most recent query, possibly still in progress. */
  currentQuery: ImageQuery | null;
  /** State of the current query. */
  currentQueryState: RequestState;
  /** Error message from the query, if we have one. */
  currentQueryError: string | null;
}

/**
 * Represents the status of a file that is being processed.
 */
export enum FileStatus {
  /** We have not yet started processing. */
  PENDING,
  /** We are currently processing. */
  PROCESSING,
  /** We are finished processing. */
  COMPLETE,
}

/**
 * Represents a file, as displayed in the UI.
 */
export interface FrontendFileEntity {
  /** Unique, constant ID for this file. */
  id: string;

  /** URL of the file icon. */
  iconUrl: string;
  /** Display name for the file. */
  name: string;
  /** Current status of the file. */
  status: FileStatus;
}

/**
 * Represents the state of the upload flow.
 */
export interface UploadState extends NormalizedState<FrontendFileEntity> {
  /** True if the upload dialog is currently open. */
  dialogOpen: boolean;
  /** True if the user is currently dragging a file. */
  isDragging: boolean;
}

/**
 * Represents the type of the root state structure.
 */
export interface RootState {
  thumbnailGrid: ThumbnailGridState;
  uploads: UploadState;
}
