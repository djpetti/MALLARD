import { LitElement, html, css, property, PropertyValues } from "lit-element";
import { connect } from "@captaincodeman/redux-connect-element";
import store from "./store";
import { ImageEntity, RootState } from "./types";
import "./thumbnail-grid-section";
import {
  thumbnailGridSelectors,
  thunkLoadMetadata,
} from "./thumbnail-grid-slice";
import { Action } from "redux";

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

    const captureDate: string = entity.metadata.captureDate;
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
export class ThumbnailGrid extends LitElement {
  static tagName: string = "thumbnail-grid";
  static styles = css`
    #empty_message {
      color: var(--theme-gray);
      font-family: "Roboto", sans-serif;
      font-weight: 100;
      margin: auto;
      width: 50%;
      text-align: center;
      padding-top: 5%;
      font-size: xxx-large;
    }
  `;

  /** The unique IDs of the artifacts whose thumbnails are displayed in this component. */
  @property({ type: Array })
  displayedArtifacts: string[] = [];

  /**
   * Unique IDs of artifacts grouped by date.
   */
  @property({ type: String, attribute: false })
  groupedArtifacts: GroupedImages[] = [];

  /**
   * @inheritDoc
   */
  protected render() {
    if (this.groupedArtifacts.length == 0) {
      // Show some text indicating that there is no data.
      return html`<h1 id="empty_message">No Data</h1>`;
    }

    return html`
      <div class="thumbnail_grid">
        ${this.groupedArtifacts.map(
          (e) => html`
            <thumbnail-grid-section
              .sectionHeader=${e.captureDate.toDateString()}
              .displayedArtifacts=${e.imageIds}
            ></thumbnail-grid-section>
          `
        )}
      </div>
    `;
  }

  /**
   * @inheritDoc
   */
  protected updated(_changedProperties: PropertyValues) {
    if (_changedProperties.has("displayedArtifacts")) {
      // The displayed images have changed. We need to fire an event
      // to kick off metadata loading.
      this.dispatchEvent(
        new CustomEvent<string[]>("images-changed", {
          bubbles: true,
          composed: false,
          detail: this.displayedArtifacts,
        })
      );
    }
  }
}

interface ImagesChangedEvent extends Event {
  detail: string[];
}

/**
 * Extension of `ThumbnailGrid` that connects to Redux.
 */
export class ConnectedThumbnailGrid extends connect(store, ThumbnailGrid) {
  /**
   * @inheritDoc
   */
  mapState(state: RootState): { [p: string]: any } {
    // In this case, we know that all IDs are strings.
    const allIds: string[] = thumbnailGridSelectors.selectIds(
      state
    ) as string[];

    // Group the artifacts by date.
    let grouped: GroupedImages[] = [];
    try {
      grouped = groupByDate(allIds, state);
    } catch (MetadataError) {
      // We don't have all the metadata yet. Ignore this.
    }

    // Sort grouped images by date, descending.
    grouped.sort((a, b): number => {
      return b.captureDate.getTime() - a.captureDate.getTime();
    });

    return {
      displayedArtifacts: allIds,
      groupedArtifacts: grouped,
    };
  }

  /**
   * @inheritDoc
   */
  mapEvents(): { [p: string]: (event: Event) => Action } {
    return {
      // The fancy casting here is a hack to deal with the fact that thunkLoadMetadata
      // produces an AsyncThunkAction but mapEvents is typed as requiring an Action.
      // However, it still works just fine with an AsyncThunkAction.
      "images-changed": (event: Event) =>
        thunkLoadMetadata(
          (event as ImagesChangedEvent).detail
        ) as unknown as Action,
    };
  }
}
