import { ThunkAction } from "redux-thunk";
import { Action } from "redux";

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
 * Represents the action for starting a new query.
 */
export interface StartQueryAction {
  type: string;
  /** The query that we are currently processing. */
  payload: ImageQuery;
}

/**
 * Represents an action for updating the state with query results.
 */
export interface UpdateQueryResultsAction {
  type: string;
  /** The results from the query. */
  payload: QueryResult;
}

/**
 * Represents a particular artifact in MALLARD.
 */
export class ArtifactId {
  /**
   * @param {string} bucket The bucket name for this artifact.
   * @param {string} name The unique ID for this artifact.
   */
  constructor(public bucket: string, public name: string) {}
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
  pageNum: Number;
  /** Whether this is the last page of query results. */
  isLastPage: boolean;
}

/**
 * Represents the state of the thumbnail grid.
 */
export interface ThumbnailGridState {
  /** Set of thumbnails that have been successfully loaded. */
  visibleThumbnails: ArtifactId[];
  /** Set of thumbnails that are currently still loading. */
  loadingThumbnails: ArtifactId[];
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

export type ThumbnailGridThunk<ReturnType = void> = ThunkAction<
  ReturnType,
  RootState,
  unknown,
  Action<string>
>;
