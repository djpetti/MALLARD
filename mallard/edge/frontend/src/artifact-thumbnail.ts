import { css } from "lit-element";
import { connect } from "@captaincodeman/redux-connect-element";
import store from "./store";
import { ImageEntity, RootState, ImageStatus } from "./types";
import {
  thumbnailGridSelectors,
  thunkLoadThumbnail,
} from "./thumbnail-grid-slice";
import { Action } from "redux";
import { ImageChangedEvent, ImageDisplay } from "./image-display";

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
    }

    .placeholder {
      height: 100%;
    }

    ${ImageDisplay.styles}
  `;

  static tagName: string = "artifact-thumbnail";
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
    return `details/${backendId.bucket}/${backendId.name}`;
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
    const imageEntity: ImageEntity = thumbnailGridSelectors.selectById(
      state,
      this.frontendId
    ) as ImageEntity;
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
