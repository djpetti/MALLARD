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
 * Represents the type of the root state structure.
 */
export interface RootState {
  thumbnailGrid: ThumbnailGridState;
}
