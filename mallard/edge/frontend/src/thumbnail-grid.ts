import { css, html, property, PropertyValues } from "lit-element";
import { connect } from "@captaincodeman/redux-connect-element";
import store from "./store";
import { ImageEntity, ImageQuery, RequestState, RootState } from "./types";
import "./thumbnail-grid-section";
import {
  thumbnailGridSelectors,
  thunkLoadMetadata,
  thunkStartQuery,
} from "./thumbnail-grid-slice";
import { Action } from "redux";
import "@material/mwc-circular-progress";
import { InfiniteScrollingElement } from "./infinite-scrolling-element";
import { Field, Ordering } from "typescript-axios";

/** Custom error to signify missing image metadata. */
class MetadataError extends Error {}

/**
 * Encapsulates image IDs grouped with corresponding metadata.
 */
interface GroupedImages {
  /** The image IDs. */
  imageIds: string[];
  /** The capture data for these images. */
  captureDate: Date;
}

/**
 * Groups a series of images by their capture dates.
 * @param {string[]} imageIds The IDs of the images to group.
 * @param {RootState} state The Redux state that contains the image metadata.
 * @return {GroupedImages[]} The same image IDs, but grouped with corresponding
 *  capture dates.
 */
function groupByDate(imageIds: string[], state: RootState): GroupedImages[] {
  // Maps date strings to image IDs with that capture data.
  const datesToImages = new Map<string, string[]>();

  for (const imageId of imageIds) {
    const entity = thumbnailGridSelectors.selectById(
      state,
      imageId
    ) as ImageEntity;
    if (entity.metadata == null) {
      // If we're missing metadata, we cannot proceed.
      throw new MetadataError(
        "Cannot group images when all metadata is not present."
      );
    }

    const captureDate: string = entity.metadata.captureDate as string;
    if (!datesToImages.has(captureDate)) {
      // Add the empty group.
      datesToImages.set(captureDate, []);
    }
    (datesToImages.get(captureDate) as string[]).push(imageId);
  }

  // Convert to the final return type.
  const imageGroups: GroupedImages[] = [];
  for (const [date, images] of datesToImages) {
    imageGroups.push({ imageIds: images, captureDate: new Date(date) });
  }
  return imageGroups;
}

/**
 * A scrollable grid of thumbnails with multiple sections.
 */
export class ThumbnailGrid extends InfiniteScrollingElement {
  static tagName: string = "thumbnail-grid";
  static styles = css`
    :host {
      height: 90vh;
      display: block;
      overflow: auto;
    }

    #empty_message {
      color: var(--theme-gray);
      font-family: "Roboto", sans-serif;
      font-weight: 100;
      margin: auto;
      width: 50%;
      text-align: center;
      font-size: xxx-large;
    }

    .top_offset {
      padding-top: 5%;
    }

    .hidden {
      display: none;
    }
  `;

  /**
   * Name for the custom event signaling that the displayed images have
   * changed. */
  static IMAGES_CHANGED_EVENT_NAME = "images-changed";
  /**
   * Name for the custom event signaling that the user has scrolled near
   * the bottom, and we need to load more data.
   */
  static LOAD_MORE_DATA_EVENT_NAME = "load-more-data";

  /** The unique IDs of the artifacts whose thumbnails are displayed in this component. */
  @property({ type: Array })
  displayedArtifacts: string[] = [];

  /**
   * Unique IDs of artifacts grouped by date.
   */
  @property({ attribute: false })
  groupedArtifacts: GroupedImages[] = [];

  /** Whether we are still loading data. */
  @property()
  public isLoading: boolean = false;

  /** Whether the last query has completed. Will be false if
   * no query has been run yet, or it is still in-progress.
   */
  @property()
  public queryComplete: boolean = false;

  /**
   * Keeps track of whether there are more pages of data to be loaded.
   */
  @property()
  public hasMorePages: boolean = true;

  /**
   * Keeps track of which page of artifacts we should load next.
   */
  private _nextQueryPage: number = 1;

  /**
   * @inheritDoc
   */
  protected override loadNextSection(): boolean {
    if (!this.hasMorePages) {
      // We have nothing more to load, so don't bother.
      return false;
    }

    // Dispatch an event. This will trigger an action that loads
    // the next page.
    this.dispatchEvent(
      new CustomEvent<number>(ThumbnailGrid.LOAD_MORE_DATA_EVENT_NAME, {
        bubbles: true,
        composed: false,
        detail: this._nextQueryPage++,
      })
    );

    return true;
  }

  /**
   * @inheritDoc
   */
  protected override isBusy(): boolean {
    return this.isLoading;
  }

  /**
   * @inheritDoc
   */
  protected render() {
    // Visibility of the "no data" message.
    const emptyMessageVisibility =
      this.queryComplete && this.groupedArtifacts.length == 0 ? "" : "hidden";
    // Visibility of the loading indicator.
    const loadingVisibility = !this.queryComplete ? "" : "hidden";
    // Visibility of the content.
    const contentVisibility = this.groupedArtifacts.length == 0 ? "hidden" : "";

    return html`
      <link rel="stylesheet" href="./static/mallard-edge.css" />

      <!-- Show a message if we have no data. -->
      <h1
        id="empty_message"
        class="${emptyMessageVisibility} center top_offset"
      >
        No Data
      </h1>

      <div class="thumbnail_grid ${contentVisibility}">
        ${this.groupedArtifacts.map(
          (e) => html`
            <thumbnail-grid-section
              .sectionHeader=${e.captureDate.toDateString()}
              .displayedArtifacts=${e.imageIds}
            ></thumbnail-grid-section>
          `
        )}
      </div>

      <!-- Show a loading indicator if needed. -->
      <mwc-circular-progress
        id="loading_indicator"
        indeterminate
        density="14"
        class="${loadingVisibility} center top_offset"
      ></mwc-circular-progress>
    `;
  }

  /**
   * @inheritDoc
   */
  protected updated(_changedProperties: PropertyValues) {
    super.updated(_changedProperties);

    if (_changedProperties.has("displayedArtifacts")) {
      // The displayed images have changed. We need to fire an event
      // to kick off metadata loading.
      this.dispatchEvent(
        new CustomEvent<string[]>(ThumbnailGrid.IMAGES_CHANGED_EVENT_NAME, {
          bubbles: true,
          composed: false,
          detail: this.displayedArtifacts,
        })
      );
    }
  }
}

/**
 * Custom event fired when the displayed images change.
 * In this case, the event detail is an array of the image UUIDs
 * that were added.
 */
type ImagesChangedEvent = CustomEvent<string[]>;
/**
 * Custom event fired when we need to load more data.
 * In this case, the event detail is the page number to load.
 */
type LoadMoreDataEvent = CustomEvent<number>;

/**
 * Extension of `ThumbnailGrid` that connects to Redux.
 */
export class ConnectedThumbnailGrid extends connect(store, ThumbnailGrid) {
  /**
   * Initial query to use for fetching images when the page first loads.
   * This will apply no filters and get everything.
   * @private
   */
  private static DEFAULT_QUERY: ImageQuery = {};
  /**
   * Initial ordering to use when the page loads. This will put the
   * newest stuff at the top.
   * @private
   */
  private static DEFAULT_ORDERINGS: Ordering[] = [
    { field: Field.CAPTURE_DATE, ascending: false },
  ];
  /**
   * Number of images to request at a time from the backend.
   * @private
   */
  private static IMAGES_PER_PAGE = 50;

  /**
   * @inheritDoc
   */
  mapState(state: RootState): { [p: string]: any } {
    // In this case, we know that all IDs are strings.
    const allIds: string[] = thumbnailGridSelectors.selectIds(
      state
    ) as string[];

    // Group the artifacts by date.
    let grouped = this.groupedArtifacts;
    try {
      grouped = groupByDate(allIds, state);
    } catch (MetadataError) {
      // We don't have all the metadata yet. Ignore this.
    }

    // Sort grouped images by date, descending.
    grouped.sort((a, b): number => {
      return b.captureDate.getTime() - a.captureDate.getTime();
    });

    // Determine the loading status.
    const isLoading =
      state.thumbnailGrid.currentQueryState == RequestState.LOADING ||
      state.thumbnailGrid.metadataLoadingState == RequestState.LOADING;
    const queryComplete =
      state.thumbnailGrid.currentQueryState == RequestState.SUCCEEDED &&
      state.thumbnailGrid.metadataLoadingState == RequestState.SUCCEEDED;

    return {
      isLoading: isLoading,
      queryComplete: queryComplete,
      displayedArtifacts: allIds,
      groupedArtifacts: grouped,
      hasMorePages: state.thumbnailGrid.lastQueryHasMorePages,
    };
  }

  /**
   * @inheritDoc
   */
  mapEvents(): { [p: string]: (event: Event) => Action } {
    const handlers: { [p: string]: (event: Event) => Action } = {};

    // The fancy casting here is a hack to deal with the fact that thunkLoadMetadata
    // produces an AsyncThunkAction but mapEvents is typed as requiring an Action.
    // However, it still works just fine with an AsyncThunkAction.
    handlers[ConnectedThumbnailGrid.IMAGES_CHANGED_EVENT_NAME] = (
      event: Event
    ) =>
      thunkLoadMetadata(
        (event as ImagesChangedEvent).detail
      ) as unknown as Action;
    handlers[ConnectedThumbnailGrid.LOAD_MORE_DATA_EVENT_NAME] = (
      event: Event
    ) =>
      thunkStartQuery({
        query: ConnectedThumbnailGrid.DEFAULT_QUERY,
        orderings: ConnectedThumbnailGrid.DEFAULT_ORDERINGS,
        resultsPerPage: ConnectedThumbnailGrid.IMAGES_PER_PAGE,
        pageNum: (event as LoadMoreDataEvent).detail,
      }) as unknown as Action;
    return handlers;
  }
}
