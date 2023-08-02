import { css, html, PropertyValues } from "lit";
import { property, query, queryAll, state } from "lit/decorators.js";
import { connect } from "@captaincodeman/redux-connect-element";
import store from "./store";
import { ArtifactEntity, ImageQuery, RequestState, RootState } from "./types";
import "./thumbnail-grid-section";
import {
  thumbnailGridSelectors,
  thunkContinueQuery,
  thunkStartNewQuery,
} from "./thumbnail-grid-slice";
import { Action } from "redux";
import "@material/mwc-circular-progress";
import { InfiniteScrollingElement } from "./infinite-scrolling-element";
import { flatten, isEqual } from "lodash";
import { ThumbnailGridSection } from "./thumbnail-grid-section";

/**
 * Encapsulates image IDs grouped with corresponding metadata.
 */
export interface GroupedImages {
  /** The image IDs. */
  imageIds: string[];
  /** The capture data for these images. */
  captureDate: Date;
  /** The session for these images. */
  session?: string;
}

/**
 * Groups a series of images by their capture dates and sessions.
 * @param {string[]} imageIds The IDs of the images to group.
 * @param {RootState} state The Redux state that contains the image metadata.
 * @return {GroupedImages[]} The same image IDs, but grouped with corresponding
 *  capture dates.
 */
function groupByDateAndSession(
  imageIds: string[],
  state: RootState
): GroupedImages[] {
  // Maps date strings to image IDs with that capture data.
  const keysToImages = new Map<
    string,
    { date: string; session: string | undefined; images: string[] }
  >();

  for (const imageId of imageIds) {
    const entity = thumbnailGridSelectors.selectById(
      state,
      imageId
    ) as ArtifactEntity;
    if (entity.metadata == null) {
      // If we're missing metadata, exclude this image.
      continue;
    }

    const captureDate = entity.metadata.captureDate as string;
    const session = entity.metadata.sessionName;
    const key = captureDate + session ?? "";
    if (!keysToImages.has(key)) {
      // Add the empty group.
      keysToImages.set(key, {
        date: captureDate,
        session: session,
        images: [],
      });
    }
    (keysToImages.get(key)?.images as string[]).push(imageId);
  }

  // Convert to the final return type.
  const imageGroups: GroupedImages[] = [];
  for (const value of keysToImages.values()) {
    imageGroups.push({
      imageIds: value.images,
      captureDate: new Date(value.date),
      session: value.session,
    });
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
   * Number of images to request at a time from the backend.
   */
  public static readonly IMAGES_PER_PAGE: number = 50;
  /**
   * Maximum number of thumbnails we will keep loaded at once.
   */
  public static readonly MAX_THUMBNAILS_LOADED: number = 500;
  /**
   * Name for the custom event signaling that the user has scrolled near
   * the bottom, and we need to load more data.
   */
  static readonly LOAD_MORE_DATA_BOTTOM_EVENT_NAME = `${ThumbnailGrid.tagName}-load-more-data-bottom`;

  /**
   * Artifacts grouped by section.
   */
  @state({
    // Do a deep check here since spurious re-rendering is expensive.
    hasChanged: (newValue, oldValue) => !isEqual(oldValue, newValue),
  })
  public groupedArtifacts: GroupedImages[] = [];
  /**
   * Unique IDs of grouped artifacts.
   */
  protected groupedArtifactsFlatIds: string[] = [];

  /** Represents the status of the data loading process. */
  @property({ attribute: false })
  public loadingState: RequestState = RequestState.IDLE;

  /**
   * Keeps track of whether there are more pages of data to be loaded.
   */
  @property()
  public hasMorePages: boolean = true;

  @queryAll("thumbnail-grid-section")
  private sections!: ThumbnailGridSection[];

  @query("#grid_content", true)
  private gridContent!: HTMLDivElement;

  /**
   * Total number of thumbnails displayed on the last update cycle.
   */
  private lastNumThumbnailsDisplayed: number = 0;

  /**
   * @inheritDoc
   */
  protected override getContentElement(): HTMLElement {
    return this.gridContent;
  }

  /**
   * @inheritDoc
   */
  protected override getParentElement(): HTMLElement {
    return this.gridContent;
  }

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
      new CustomEvent<void>(ThumbnailGrid.LOAD_MORE_DATA_BOTTOM_EVENT_NAME, {
        bubbles: true,
        composed: false,
      })
    );

    return true;
  }

  /**
   * @inheritDoc
   */
  protected override onChildrenVisible(_children: Element[]) {
    // Enable visibility tracking on the child.
    for (const child of _children) {
      (child as ThumbnailGridSection).enableVisibilityTracking();
    }
  }

  /**
   * @inheritDoc
   */
  protected override onChildrenNotVisible(_children: Element[]) {
    // Clear any data for the invisible child to save memory. There's also
    // no point in keeping visibility tracking enabled, because we know the
    // entire section is invisible.
    for (const child of _children) {
      (child as ThumbnailGridSection).disableVisibilityTracking();
      (child as ThumbnailGridSection).clearThumbnails();
    }
  }

  /**
   * @inheritDoc
   */
  protected override isBusy(): boolean {
    return this.loadingState == RequestState.LOADING;
  }

  /**
   * Generates a name for a section of the thumbnail grid.
   * @param {GroupedImages} group The group associated with this section.
   * @return {string} The name for the section.
   * @private
   */
  private makeSectionName(group: GroupedImages): string {
    const date = group.captureDate.toISOString().split("T")[0];
    if (!group.session) {
      // If we have no session name, just show the date.
      return date;
    } else {
      return `${group.session} (${date})`;
    }
  }

  /**
   * Counts the total number of thumbnails that are actually being
   * displayed (not in collapsed sections).
   * @return {number} The number of displayed thumbnails.
   * @private
   */
  private numThumbnailsDisplayed(): number {
    let numThumbnails = 0;
    for (const section of this.sections) {
      if (!section.expanded) {
        // Section is collapsed. Don't count it.
        continue;
      }

      numThumbnails += section.displayedArtifacts.length;
    }

    return numThumbnails;
  }

  /**
   * @inheritDoc
   */
  protected override render() {
    // Visibility of the "no data" message.
    const emptyMessageVisibility =
      this.loadingState == RequestState.SUCCEEDED &&
      this.groupedArtifacts.length == 0
        ? ""
        : "hidden";
    // Visibility of the loading indicator.
    const loadingVisibility =
      this.sufficientDataLoaded || !this.hasMorePages ? "hidden" : "";
    // Visibility of the content.
    const contentVisibility = this.groupedArtifacts.length == 0 ? "hidden" : "";

    return html`
      <link rel="stylesheet" href="/static/mallard-edge.css" />

      <!-- Show a message if we have no data. -->
      <h1
        id="empty_message"
        class="${emptyMessageVisibility} center top_offset"
      >
        No Data
      </h1>

      <div class="thumbnail_grid ${contentVisibility}" id="grid_content">
        ${this.groupedArtifacts.map(
          (g) => html`
            <thumbnail-grid-section
              .sectionHeader=${this.makeSectionName(g)}
              .displayedArtifacts=${g.imageIds}
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
  protected override async updated(_changedProperties: PropertyValues) {
    super.updated(_changedProperties);

    if (_changedProperties.has("groupedArtifacts")) {
      // Reset the visibility tracker, since it could be invalid with these
      // new images.
      this.resetVisibilityTracking();
    }

    if (_changedProperties.get("loadingState") == RequestState.LOADING) {
      const numThumbnailsDisplayed = this.numThumbnailsDisplayed();
      if (numThumbnailsDisplayed <= this.lastNumThumbnailsDisplayed) {
        // The number of displayed thumbnails didn't change. This could mean
        // that we loaded data internal to a collapsed section and should
        // check if we should load more.
        this.loadContentWhileNeeded();
      }
      this.lastNumThumbnailsDisplayed = numThumbnailsDisplayed;
    }
  }

  /**
   * @inheritDoc
   */
  protected firstUpdated(properties: PropertyValues) {
    super.firstUpdated(properties);

    // If we have no data, try loading some initially.
    if (this.groupedArtifacts.length == 0) {
      this.loadNextSection();
    }

    // The visibility checking code relies on receiving scroll events.
    // However, scroll events only go to this element instead of the section
    // elements, so we manually forward them to get around this.
    this.addEventListener("scroll", () => {
      for (const child of this.gridContent.children) {
        child.dispatchEvent(new Event("scroll"));
      }
    });
  }
}

/**
 * Extension of `ThumbnailGrid` that connects to Redux.
 */
export class ConnectedThumbnailGrid extends connect(store, ThumbnailGrid) {
  /**
   * Initial query to use for fetching images when the page first loads.
   * This will apply no filters and get everything.
   * @private
   */
  private static DEFAULT_QUERY: ImageQuery[] = [{}];

  /**
   * Keeps track of whether a query has been started yet.
   */
  public isQueryRunning: boolean = false;

  /**
   * Keeps track of which page of artifacts we just loaded.
   */
  public queryPageNum: number = 0;

  /**
   * @inheritDoc
   */
  mapState(state: RootState): { [p: string]: any } {
    // In this case, we know that all IDs are strings.
    const allIds: string[] = thumbnailGridSelectors.selectIds(
      state
    ) as string[];

    // Group the artifacts by date.
    const grouped = groupByDateAndSession(allIds, state);

    // Sort grouped images by date, descending, and then by session name.
    grouped.sort((a, b): number => {
      const timeDiff = b.captureDate.getTime() - a.captureDate.getTime();
      if (timeDiff == 0) {
        // Sort by session as a secondary key.
        const aSession = a.session ?? "";
        const bSession = b.session ?? "";
        return aSession > bSession ? 1 : aSession < bSession ? -1 : 0;
      }

      return timeDiff;
    });

    // Determine the loading status.
    const contentState = state.imageView.currentQueryState;
    const metadataState = state.imageView.metadataLoadingState;
    // If they're in different states, then the overall state will be loading,
    // because it implies that the process isn't 100% finished.
    let overallState = RequestState.LOADING;
    if (
      contentState === RequestState.IDLE &&
      metadataState === RequestState.IDLE
    ) {
      overallState = RequestState.IDLE;
    } else if (
      contentState === RequestState.SUCCEEDED &&
      (metadataState === RequestState.SUCCEEDED || allIds.length === 0)
    ) {
      // The allIds check here is to cover a corner case where we don't have
      // any images. In this case, there will be no metadata to load.
      overallState = RequestState.SUCCEEDED;
    }

    return {
      loadingState: overallState,
      groupedArtifacts: grouped,
      groupedArtifactsFlatIds: flatten(grouped.map((g) => g.imageIds)),
      hasMorePages: state.imageView.currentQueryHasMorePages,

      queryPageNum: state.imageView.currentQueryOptions.pageNum,
      isQueryRunning: state.imageView.currentQuery.length > 0,
    };
  }

  /**
   * @inheritDoc
   */
  override mapEvents(): { [p: string]: (event: Event) => Action } {
    const handlers: { [p: string]: (event: Event) => Action } = {};

    // The fancy casting here is a hack to deal with the fact that thunkLoadMetadata
    // produces an AsyncThunkAction but mapEvents is typed as requiring an Action.
    // However, it still works just fine with an AsyncThunkAction.
    handlers[ConnectedThumbnailGrid.LOAD_MORE_DATA_BOTTOM_EVENT_NAME] = (
      _: Event
    ) => {
      if (!this.isQueryRunning) {
        // Start a new query.
        return thunkStartNewQuery({
          query: ConnectedThumbnailGrid.DEFAULT_QUERY,
          resultsPerPage: ConnectedThumbnailGrid.IMAGES_PER_PAGE,
        }) as unknown as Action;
      } else {
        // Continue the existing query.
        return thunkContinueQuery(this.queryPageNum + 1) as unknown as Action;
      }
    };
    return handlers;
  }
}
