import { Dictionary, EntityId } from "@reduxjs/toolkit";
import {
  Ordering,
  PlatformType,
  RangeDate,
  TypedObjectRef,
  UavImageMetadata,
  UavVideoMetadata,
} from "mallard-api";
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
  /** Session for the images to search for. */
  session?: string;
  /** Date range to search for. */
  captureDates?: RangeDate;
  /** The type of platform to search for. */
  platformType?: PlatformType;
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
export enum ArtifactStatus {
  /** Artifact has not been loaded yet. */
  NOT_LOADED,
  /** Artifact is loading. */
  LOADING,
  /** Artifact is loaded and displayed. */
  LOADED,
}

/**
 * The entry in the normalized table for artifact data.
 */
export interface ArtifactEntity {
  /** Unique ID for the artifact provided by the backend. */
  backendId: TypedObjectRef;

  /** Status of loading the artifact thumbnail. */
  thumbnailStatus: ArtifactStatus;
  /** Status of loading the full artifact. */
  imageStatus: ArtifactStatus;
  /** Status of loading the metadata. */
  metadataStatus: ArtifactStatus;

  /** The object URL of the artifact thumbnail. */
  thumbnailUrl: string | null;
  /** The object URL of the full-sized image, if this is an image */
  imageUrl: string | null;

  /** The metadata associated with the artifact. */
  metadata: UavImageMetadata | UavVideoMetadata | null;

  /** Whether this artifact is currently selected. */
  isSelected: boolean;
}

/**
 * Represents the state of the search interface.
 */
interface SearchState {
  /** Current text in the search box. */
  searchString: string;
  /** Current autocomplete suggestions. */
  autocompleteSuggestions: Suggestions;

  /** State of the autocomplete query. */
  queryState: RequestState;
}

/**
 * Represents state specific to the details page.
 */
interface DetailsState {
  /** The frontend ID of the image being displayed on the details page. */
  frontendId: string | null;
}

/**
 * Represents the state of the home and details pages.
 */
export interface ImageViewState extends NormalizedState<ArtifactEntity> {
  /** Most recent query, possibly still in progress. */
  currentQuery: ImageQuery[];
  /** Options provided for the current query. */
  currentQueryOptions: QueryOptions;

  /** State of the current query. */
  currentQueryState: RequestState;
  /** State of the metadata loading. */
  metadataLoadingState: RequestState;
  /** State of image deletion. */
  imageDeletionState: RequestState;

  /** Error message from the query, if we have one. */
  currentQueryError: string | null;
  /** Whether the last query had more pages. */
  currentQueryHasMorePages: boolean;

  /** State of the search interface. */
  search: SearchState;
  /** State of the details page. */
  details: DetailsState;

  /** Keeps track of the total number of items selected. */
  numItemsSelected: number;
  /** Keeps track of the total number of thumbnails loaded. */
  numThumbnailsLoaded: number;
  /** State of the image bulk download request. */
  bulkDownloadState: RequestState;
  /** State of the metadata editing request. */
  metadataEditingState: RequestState;
  /** URL of the exported list of images. */
  exportedImagesUrl: string | null;

  /** Keys are the names of sections, mapped to "true" if that section is
   * collapsed.
   */
  collapsedSections: Dictionary<boolean>;

  /** Whether the metadata editing dialog is currently open. */
  editingDialogOpen: boolean;
}

/**
 * Represents the status of a file that is being processed.
 */
export enum FileStatus {
  /** We have not yet started processing. */
  PENDING,
  /** We are currently pre-processing the file. */
  PRE_PROCESSING,
  /** We have preprocessed the file and are waiting to upload. */
  AWAITING_UPLOAD,
  /** We are currently uploading. */
  UPLOADING,
  /** We are finished processing. */
  COMPLETE,
}

/**
 * Represents the state of the overall upload workflow.
 */
export enum UploadWorkflowStatus {
  /**
   * We have not started uploading any files yet.
   */
  WAITING,
  /**
   * We are in the process of uploading files.
   */
  UPLOADING,
  /**
   * We are finalizing the upload.
   */
  FINALIZING,
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

  /** URL of the thumbnail data. */
  thumbnailUrl: string | null;
  /** Display name for the file. */
  name: string;
  /** Current status of the file. */
  status: FileStatus;

  /**
   * The corresponding reference to this file on the backend, if it exists there.
   */
  backendRef?: TypedObjectRef;
}

/**
 * Represents the state of the upload flow.
 */
export interface UploadState extends NormalizedState<FrontendFileEntity> {
  /** Tracks whether the upload dialog is currently open. */
  dialogOpen: boolean;
  /** True if the user is currently dragging a file. */
  isDragging: boolean;
  /** Counts the number of uploads that are in-progress. */
  uploadsInProgress: number;
  /** Counts the number of uploads that have completed. */
  uploadsCompleted: number;

  /** Status of metadata inference. */
  metadataStatus: MetadataInferenceStatus;
  /** The current metadata. Can be null if no metadata has been set or
   * inferred yet. */
  metadata: UavImageMetadata | UavVideoMetadata | null;
  /** Whether the loaded metadata has been modified by the user. */
  metadataChanged: boolean;

  /** Overall status of the upload process. */
  status: UploadWorkflowStatus;
}

/**
 * Represents the type of the root state structure.
 */
export interface RootState {
  imageView: ImageViewState;
  uploads: UploadState;
}
