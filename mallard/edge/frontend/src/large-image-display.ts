import {
  ImageChangedEvent,
  ImageDisplay,
  ImageIdentifier,
} from "./image-display";
import { css, PropertyValues } from "lit";
import { property } from "lit/decorators.js";
import { connect } from "@captaincodeman/redux-connect-element";
import store from "./store";
import { ImageStatus } from "./types";
import {
  addArtifact,
  thunkClearFullSizedImage,
  createImageEntityId,
  thumbnailGridSelectors,
  thunkLoadImage,
} from "./thumbnail-grid-slice";
import { Action } from "redux";
import { ObjectRef } from "mallard-api";

/**
 * An element for displaying a full-sized image.
 * @customElement large-image-display
 */
export class LargeImageDisplay extends ImageDisplay {
  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100vh;
    }

    .placeholder {
      height: 100vh;
    }

    img {
      height: 100vh;
    }

    ${ImageDisplay.styles}
  `;

  static tagName = "large-image-display";

  /**
   * The bucket that this image is in on the backend. Useful
   * for displaying images that have not already been loaded
   * by the frontend.
   */
  @property({ type: String })
  backendBucket?: string;

  /**
   * The UUID of this image on the backend. Useful for displaying
   * images that have already been loaded by the frontend.
   */
  @property({ type: String })
  backendName?: string;

  // Default to showing the animation for large images, which might
  // take a while to load.
  showLoadingAnimation = true;

  /**
   * Adjusts the size of the image so that it takes up the maximum amount of
   * screen real-estate without overflowing.
   * @private
   */
  private adjustSizes() {
    const fullscreenHeight = this.clientHeight;

    // Adjust the image and placeholder to use the full height.
    if (this.imageContainer) {
      this.imageContainer.style.height = `${fullscreenHeight}px`;
    }
    if (this.image) {
      this.image.style.height = `${fullscreenHeight}px`;
    }
  }

  /**
   * @inheritDoc
   */
  protected override firstUpdated(_changedProperties: PropertyValues) {
    super.firstUpdated(_changedProperties);

    // Always resize after the first rendering.
    this.adjustSizes();
  }

  /**
   * @inheritDoc
   */
  protected override updated(_changedProperties: PropertyValues) {
    super.updated(_changedProperties);

    if (
      (_changedProperties.has("backendBucket") ||
        _changedProperties.has("backendName")) &&
      this.backendBucket &&
      this.backendName
    ) {
      // Dispatch an event indicating that an image was set.
      this.dispatchEvent(
        new CustomEvent<ImageIdentifier>(
          LargeImageDisplay.IMAGE_CHANGED_EVENT_NAME,
          {
            bubbles: true,
            composed: false,
            detail: {
              backendId: { bucket: this.backendBucket, name: this.backendName },
            },
          }
        )
      );
    }

    if (_changedProperties.has("imageUrl")) {
      this.adjustSizes();
    }
  }
}

/**
 * Interface for the custom event we dispatch when the element is
 * connected or disconnected.
 */
export interface ConnectionChangedEvent extends Event {
  /** The frontend ID of the currently-set image. */
  detail?: string;
}

/**
 * Extension of `LargeImageDisplay` that connects to Redux.
 */
export class ConnectedLargeImageDisplay extends connect(
  store,
  LargeImageDisplay
) {
  /**
   * Name for the custom event signaling that the element is disconnected from the DOM.
   */
  static DISCONNECTED_EVENT_NAME = `${LargeImageDisplay.tagName}-disconnected`;

  /**
   * The implementation of `disconnectedCallback()` from`redux-connect-element`
   * unfortunately de-registers the event listeners *before* calling the
   * superclass version, so we have to implement this method here, or it will
   * never handle the event and dispatch the Redux action.
   * @inheritDoc
   */
  public override disconnectedCallback() {
    // Dispatch the correct event.
    this.dispatchEvent(
      new CustomEvent<string | undefined>(
        ConnectedLargeImageDisplay.DISCONNECTED_EVENT_NAME,
        {
          bubbles: true,
          composed: false,
          detail: this.frontendId,
        }
      )
    );
    super.disconnectedCallback();
  }

  /**
   * @inheritDoc
   */
  mapState(state: any): { [p: string]: any } {
    let frontendId = this.frontendId;
    if (!frontendId) {
      if (this.backendBucket && this.backendName) {
        // Try setting the image ID based on the backend ID.
        frontendId = createImageEntityId({
          bucket: this.backendBucket,
          name: this.backendName,
        });
      } else {
        // We don't have any image specified, so we can't do anything.
        return {};
      }
    }

    const imageEntity = thumbnailGridSelectors.selectById(state, frontendId);
    if (!imageEntity) {
      // Image loading has not been started yet.
      return {};
    }
    if (imageEntity.imageStatus != ImageStatus.VISIBLE) {
      // The image is has not been loaded yet, but it is registered in the
      // frontend, so we can set the frontend ID.
      return { frontendId: frontendId };
    }

    return { imageUrl: imageEntity.imageUrl };
  }

  /**
   * @inheritDoc
   */
  mapEvents(): { [p: string]: (event: Event) => Action } {
    const handlers: { [p: string]: (event: Event) => Action } = {};

    // The fancy casting here is a hack to deal with the fact that thunkLoadThumbnail
    // produces an AsyncThunkAction but mapEvents is typed as requiring an Action.
    // However, it still works just fine with an AsyncThunkAction.
    handlers[ConnectedLargeImageDisplay.IMAGE_CHANGED_EVENT_NAME] = (
      event: Event
    ) => {
      const imageEvent = event as ImageChangedEvent;
      if (imageEvent.detail.frontendId) {
        // Image has already been registered on the frontend.
        return thunkLoadImage(
          imageEvent.detail.frontendId
        ) as unknown as Action;
      } else {
        // Register the image manually.
        return addArtifact(imageEvent.detail.backendId as ObjectRef);
      }
    };
    handlers[ConnectedLargeImageDisplay.DISCONNECTED_EVENT_NAME] = (
      event: Event
    ) =>
      thunkClearFullSizedImage(
        (event as ConnectionChangedEvent).detail
      ) as unknown as Action;
    return handlers;
  }
}
