import { css, html, LitElement, property, PropertyValues } from "lit-element";
import { connect } from "@captaincodeman/redux-connect-element";
import store from "./store";
import { ImageEntity, RootState, ThumbnailStatus } from "./types";
import {
  thumbnailGridSelectors,
  thunkLoadThumbnail,
} from "./thumbnail-grid-slice";
import { Action } from "redux";

/**
 * Thumbnail representation of an uploaded artifact.
 * @customElement artifact-thumbnail
 */
export class ArtifactThumbnail extends LitElement {
  static styles = css`
    :host {
      display: inline-block;
      border: none;
      margin: 0.5rem;
      min-width: 128px;
      min-height: 80px;
    }

    .placeholder {
      background-color: var(--theme-gray);
      width: 100%;
      height: 100%;
    }

    img {
      display: block;
      max-width: 100%;
      max-height: 100%;
    }
  `;

  static tagName: string = "artifact-thumbnail";

  /**
   * The unique ID of the artifact being displayed here.
   */
  @property({ type: String })
  imageId: string | null = null;

  /**
   * The URL of the thumbnail image to display.
   */
  @property({ type: String, attribute: false })
  imageUrl: string | null = null;

  /**
   * Checks if an image is set for this component.
   * @return {boolean} True iff an actual image is set in this component.
   */
  get hasImage(): boolean {
    return this.imageUrl != null;
  }

  /**
   * @inheritDoc
   */
  protected render() {
    // Only show the placeholder if we don't have an image.
    const placeholderClass = this.hasImage ? "" : "placeholder";

    return html`
      <div id="image_container" class="${placeholderClass}">
        ${this.hasImage
          ? html` <img src="${this.imageUrl as string}" alt="thumbnail" /> `
          : html``}
      </div>
    `;
  }

  /**
   * @inheritDoc
   */
  protected updated(_changedProperties: PropertyValues) {
    if (_changedProperties.has("imageId")) {
      // The image ID has changed. We need to fire an event for this to kick
      // off the actual thumbnail load.
      this.dispatchEvent(
        new CustomEvent<string | null>("image-changed", {
          bubbles: true,
          composed: false,
          detail: this.imageId,
        })
      );
    }
  }
}

/**
 * Interface for the custom event we dispatch when the image
 * is changed.
 */
interface ImageChangedEvent extends Event {
  detail: string;
}

/**
 * Extension of `ArtifactThumbnail` that connects to Redux.
 */
export class ConnectedArtifactThumbnail extends connect(
  store,
  ArtifactThumbnail
) {
  /**
   * @inheritDoc
   */
  mapState(state: RootState): { [p: string]: any } {
    if (this.imageId == null) {
      // No specific thumbnail has been set.
      return {};
    }

    // This should never be undefined, because that means our image ID is invalid.
    const imageEntity: ImageEntity = thumbnailGridSelectors.selectById(
      state,
      this.imageId
    ) as ImageEntity;
    if (imageEntity.status != ThumbnailStatus.VISIBLE) {
      // The thumbnail image is has not been loaded yet.
      return {};
    }

    return {
      imageUrl: imageEntity.imageUrl,
    };
  }

  /**
   * @inheritDoc
   */
  mapEvents(): { [p: string]: (event: Event) => Action } {
    return {
      // The fancy casting here is a hack to deal with the fact that thunkLoadThumbnail
      // produces an AsyncThunkAction but mapEvents is typed as requiring an Action.
      // However, it still works just fine with an AsyncThunkAction.
      "image-changed": (event: Event) =>
        thunkLoadThumbnail(
          (event as ImageChangedEvent).detail
        ) as unknown as Action,
    };
  }
}
