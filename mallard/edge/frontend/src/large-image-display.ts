import { ImageDisplay } from "./image-display";
import { css, PropertyValues } from "lit";
import { connect } from "@captaincodeman/redux-connect-element";
import store from "./store";
import { ImageStatus } from "./types";
import {
  thumbnailGridSelectors,
  thunkClearFullSizedImages,
  thunkLoadImage,
} from "./thumbnail-grid-slice";
import { Action } from "redux";

/**
 * An element for displaying a full-sized image.
 * @customElement large-image-display
 */
export class LargeImageDisplay extends ImageDisplay {
  static styles = css`
    :host {
      display: block;
      width: 100%;
      /* Extra 64px leaves room for the navigation bar. */
      height: calc(100vh - 64px);
    }

    .placeholder {
      height: 100vh;
    }

    img {
      height: 100vh;
    }

    ${ImageDisplay.styles}
  `;

  static readonly tagName = "large-image-display";

  // Default to showing the animation for large images, which might
  // take a while to load.
  showLoadingAnimation = true;

  /**
   * Observer for resize events on the image.
   */
  private resizeObserver!: ResizeObserver;

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

    // Add event handlers for window resizing.
    this.resizeObserver = new ResizeObserver(() => this.adjustSizes());
    this.resizeObserver.observe(this);

    // Always resize after the first rendering.
    this.adjustSizes();
  }

  /**
   * @inheritDoc
   */
  protected override updated(_changedProperties: PropertyValues) {
    super.updated(_changedProperties);

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
    const frontendId = this.frontendId;
    if (!this.frontendId) {
      // We don't have any image specified, so we can't do anything.
      return {};
    }

    const imageEntity = thumbnailGridSelectors.selectById(
      state,
      frontendId as string
    );
    if (!imageEntity || imageEntity.imageStatus != ImageStatus.LOADED) {
      // Image loading has not completed yet.
      return {};
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
    handlers[ConnectedLargeImageDisplay.ARTIFACT_CHANGED_EVENT_NAME] = (
      event: Event
    ) =>
      thunkLoadImage(
        (event as CustomEvent<string>).detail
      ) as unknown as Action;
    handlers[ConnectedLargeImageDisplay.DISCONNECTED_EVENT_NAME] = (
      event: Event
    ) =>
      thunkClearFullSizedImages([
        (event as ConnectionChangedEvent).detail,
      ]) as unknown as Action;
    return handlers;
  }
}
