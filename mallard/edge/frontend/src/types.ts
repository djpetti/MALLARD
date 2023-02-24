import { Dictionary, EntityId } from "@reduxjs/toolkit";
import {
  ObjectRef,
  Ordering,
  RangeDate,
  UavImageMetadata,
} from "typescript-axios";
import { Suggestions } from "./autocomplete";

/**
 * Represents the state of a long-running request.
 */
export enum RequestState {
  IDLE,
  LOADING,
  SUCCEEDED,
  FAILED,
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
export interface ImageQuery {
  /** Name of the images to search for. */
  name?: string;
  /** Notes for the images to search for. */
  notes?: string;
  /** Camera for the images to search for. */
  camera?: string;
  /** Date range to search for. */
  captureDates?: RangeDate;
}

/**
 * Represents the various options associated with performing a query.
 */
export interface QueryOptions {
  /** The orderings to use for the query results. */
  orderings?: Ordering[];
  /** The number of results to produce for each page. */
  resultsPerPage?: number;
  /** The page number that we loaded. */
  pageNum?: number;
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
 * The loading status of images.
 */
export enum ImageStatus {
  /** Image is loading. */
  LOADING,
  /** Image is loaded and displayed. */
  VISIBLE,
}

/**
 * The entry in the normalized table for image data.
 */
export interface ImageEntity {
  /** Unique ID for the image provided by the backend. */
  backendId: ObjectRef;

  /** Status of loading the image thumbnail. */
  thumbnailStatus: ImageStatus;
  /** Status of loading the full image. */
  imageStatus: ImageStatus;

  /** The object URL of the image thumbnail. */
  thumbnailUrl: string | null;
  /** The object URL of the full-sized image. */
  imageUrl: string | null;

  /** The metadata associated with the image. */
  metadata: UavImageMetadata | null;
}

/**
 * Represents the state of the search interface.
 */
export interface SearchState {
  /** Current text in the search box. */
  searchString: string;
  /** Current autocomplete suggestions. */
  autocompleteSuggestions: Suggestions;

  /** State of the autocomplete query. */
  queryState: RequestState;
}

/**
 * Represents the state of the home and details pages.
 */
export interface ImageViewState extends NormalizedState<ImageEntity> {
  /** Most recent query, possibly still in progress. */
  currentQuery: ImageQuery[];
  /** Options provided for the current query. */
  currentQueryOptions: QueryOptions;

  /** State of the current query. */
  currentQueryState: RequestState;
  /** State of the metadata loading. */
  metadataLoadingState: RequestState;
  /** Error message from the query, if we have one. */
  currentQueryError: string | null;
  /** Whether the last query had more pages. */
  currentQueryHasMorePages: boolean;

  /** State of the search interface. */
  search: SearchState;
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
 * Represents the status of a metadata inference request.
 */
export enum MetadataInferenceStatus {
  /** We have not made the request yet. */
  NOT_STARTED,
  /** We are waiting for the result. */
  LOADING,
  /** We have the result. */
  COMPLETE,
}

/**
 * Represents a file, as displayed in the UI.
 */
export interface FrontendFileEntity {
  /** Unique, constant ID for this file. */
  id: string;

  /** URL of the file data. */
  dataUrl: string;
  /** Display name for the file. */
  name: string;
  /** Current status of the file. */
  status: FileStatus;

  /**
   * The corresponding reference to this file on the backend, if it exists there.
   */
  backendRef?: ObjectRef;
}

/**
 * Represents the state of the upload flow.
 */
export interface UploadState extends NormalizedState<FrontendFileEntity> {
  /** True if the upload dialog is currently open. */
  dialogOpen: boolean;
  /** True if the user is currently dragging a file. */
  isDragging: boolean;
  /** Counts the number of uploads that are in-progress. */
  uploadsInProgress: number;

  /** Status of metadata inference. */
  metadataStatus: MetadataInferenceStatus;
  /** The current metadata. Can be null if no metadata has been set or
   * inferred yet. */
  metadata: UavImageMetadata | null;
  /** Whether the loaded metadata has been modified by the user. */
  metadataChanged: boolean;
}

/**
 * Represents the type of the root state structure.
 */
export interface RootState {
  imageView: ImageViewState;
  uploads: UploadState;
}
