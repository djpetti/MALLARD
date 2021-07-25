import { Dictionary, EntityId } from "@reduxjs/toolkit";
import Geo = Faker.Geo;

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
 * Possible platform types.
 */
export enum PlatformType {
  GROUND,
  AERIAL,
}

/**
 * Possible image formats.
 */
export enum ImageFormat {
  GIF,
  TIFF,
  JPEG,
  BMP,
  PNG,
}

/** Represents a point on earth. */
export interface GeoPoint {
  /** The latitude of the point, in decimal degrees. */
  latitudeDeg: number;
  /** The longitude of the point, in decimal degrees. */
  longitudeDeg: number;
}

/**
 * Represents image metadata.
 */
export interface ImageMetadata {
  /** The name of the image. */
  name?: string;
  /** The image format. */
  format?: ImageFormat;
  /** The type of platform the image came from. */
  platformType?: PlatformType;
  /** Associated notes for this image. */
  notes?: string;

  /** Session number used to group images from the same session. */
  sessionNumber?: number;
  /** Defines ordering of images within a session. */
  sequenceNumber?: number;

  /** The date that the image was captured on. This is in raw string
   * form to please Redux, but should be trivially convertible to a Date object.
   */
  captureDate?: string;
  /** The name of the camera that the image was captured by. */
  camera?: string;
  /** Location where the image was captured. */
  location?: GeoPoint;
  /** Text description of the location. */
  locationDescription?: string;

  // Aerial-platform-specific parameters.
  /** Flight altitude in meters, AGL. */
  altitudeMeters?: number;
  /** GSD in cm/px. */
  gsdCmPx?: number;
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
  metadata: ImageMetadata | null;
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
