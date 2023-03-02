import { css, html, PropertyValues } from "lit";
import { connect } from "@captaincodeman/redux-connect-element";
import store from "./store";
import { ImageEntity, RootState, ImageStatus } from "./types";
import {
  thumbnailGridSelectors,
  thunkLoadThumbnail,
} from "./thumbnail-grid-slice";
import { Action } from "redux";
import { ImageChangedEvent, ImageDisplay } from "./image-display";
import "@material/mwc-icon-button";

/**
 * Thumbnail representation of an uploaded artifact.
 * @customElement artifact-thumbnail
 */
export class ArtifactThumbnail extends ImageDisplay {
  static styles = css`
    :host {
      display: inline-block;
      margin: 0.5rem;
      min-width: 128px;
      min-height: 80px;
      position: relative;
    }

    .placeholder {
      height: 100%;
    }

    #select_button {
      position: absolute;
      z-index: 99;
      top: -10px;
      right: -10px;
      color: var(--theme-whitish);
    }

    ${ImageDisplay.styles}
  `;

  static tagName: string = "artifact-thumbnail";

  /**
   * @inheritDoc
   */
  protected override render() {
    const baseHtml = super.render();

    return html` <div>
      ${baseHtml}
      <mwc-icon-button
        id="select_button"
        icon="radio_button_unchecked"
        slot="actionItems"
      ></mwc-icon-button>
    </div>`;
  }

  /**
   * @inheritDoc
   */
  protected override firstUpdated(_: PropertyValues) {
    // Add a handler for mousing over the image, so we can show the
    // selection button.
  }
}

/**
 * Extension of `ArtifactThumbnail` that connects to Redux.
 */
export class ConnectedArtifactThumbnail extends connect(
  store,
  ArtifactThumbnail
) {
  /**
   * Creates a URL that takes us to a page with details about a particular image.
   * @param {ImageEntity} entity The image entity to make the URL for.
   * @return {string} The resulting URL.
   * @private
   */
  private static makeDetailsUrl(entity: ImageEntity): string {
    const backendId = entity.backendId;
    return `/details/${backendId.bucket}/${backendId.name}`;
  }

  /**
   * @inheritDoc
   */
  mapState(state: RootState): { [p: string]: any } {
    if (!this.frontendId) {
      // No specific thumbnail has been set.
      return {};
    }

    // This should never be undefined, because that means our image ID is invalid.
    const imageEntity = thumbnailGridSelectors.selectById(
      state,
      this.frontendId
    );
    if (imageEntity === undefined) {
      // The frontendId that was set is apparently invalid.
      return {};
    }
    if (imageEntity.thumbnailStatus != ImageStatus.VISIBLE) {
      // The thumbnail image is has not been loaded yet.
      return {};
    }

    return {
      imageUrl: imageEntity.thumbnailUrl,
      imageLink: ConnectedArtifactThumbnail.makeDetailsUrl(imageEntity),
    };
  }

  /**
   * @inheritDoc
   */
  mapEvents(): { [p: string]: (event: Event) => Action } {
    const handlers: { [p: string]: (event: Event) => Action } = {};

    // The fancy casting here is a hack to deal with the fact that thunkLoadThumbnail
    // produces an AsyncThunkAction but mapEvents is typed as requiring an Action.
    // However, it still works just fine with an AsyncThunkAction.
    handlers[ConnectedArtifactThumbnail.IMAGE_CHANGED_EVENT_NAME] = (
      event: Event
    ) =>
      thunkLoadThumbnail(
        (event as ImageChangedEvent).detail.frontendId as string
      ) as unknown as Action;
    return handlers;
  }
}
