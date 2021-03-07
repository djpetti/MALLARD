import { LitElement, html, property } from "lit-element";
import { connect } from "@captaincodeman/redux-connect-element";
import store from "./store";
import { RootState } from "./types";
import "./thumbnail-grid-section";
import { thumbnailGridSelectors } from "./thumbnail-grid-slice";

/**
 * A scrollable grid of thumbnails with multiple sections.
 */
export class ThumbnailGrid extends LitElement {
  static tagName: string = "thumbnail-grid";

  /** The unique IDs of the artifacts whose thumbnails are displayed in this component. */
  @property({ type: Array })
  displayedArtifacts: string[] = [];

  /**
   * @inheritDoc
   */
  protected render() {
    return html`
      <div class="thumbnail_grid">
        <thumbnail-grid-section
          .displayedArtifacts=${this.displayedArtifacts}
        ></thumbnail-grid-section>
      </div>
    `;
  }
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

    return {
      displayedArtifacts: allIds,
    };
  }
}
