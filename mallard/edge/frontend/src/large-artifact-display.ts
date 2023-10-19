import { ArtifactDisplay } from "./artifact-display";
import { css, html, PropertyValues, TemplateResult } from "lit";
import { connect } from "@captaincodeman/redux-connect-element";
import store from "./store";
import { ArtifactStatus } from "./types";
import {
  clearVideoUrl,
  setVideoUrl,
  thumbnailGridSelectors,
  thunkClearFullSizedImages,
  thunkLoadImage,
} from "./thumbnail-grid-slice";
import { Action } from "redux";
import { ObjectType } from "mallard-api";
import { state } from "lit/decorators.js";
import "@material/mwc-icon";
import "@material/mwc-linear-progress";

/**
 * An element for displaying a full-sized image.
 * @customElement large-artifact-display
 */
export class LargeArtifactDisplay extends ArtifactDisplay {
  static styles = css`
    @media only screen and (orientation: landscape) {
      :host {
        /* Extra 64px leaves room for the navigation bar. */
        height: calc(100vh - 64px);
      }
    }

    :host {
      display: block;
      width: 100%;
    }

    .transcode_message_background {
      background-color: var(--theme-dark-gray);
      width: 100%;
      height: 100%;

      display: flex;
      justify-content: center;
      align-items: center;
    }

    .grid_container {
      display: grid;
      grid-template-columns: auto 30px auto;
      justify-items: center;
      align-items: center;
    }

    h1 {
      font-family: Roboto;
      font-size: 40pt;
      font-weight: bold;
      color: var(--theme-whitish);
    }

    p {
      font-family: Roboto;
      font-size: 12pt;
      font-weight: lighter;
      color: var(--theme-whitish);
    }

    .grid_full_row {
      /* Use an entire row of the grid layout. */
      grid-column-start: 1;
      grid-column-end: 4;
    }

    .grid_justify_right {
      justify-self: end;
    }

    .grid_justify_left {
      justify-self: start;
    }

    #download_icon {
      color: var(--theme-whitish);
    }

    .placeholder {
      height: 100vh;
    }

    ${ArtifactDisplay.styles}
  `;

  static readonly tagName = "large-artifact-display";

  /**
   * If true, it will show a message about video transcoding running instead
   * of the artifact itself.
   * @private
   */
  @state()
  private showTranscodingMessage: boolean = false;

  /**
   * Interval that will periodically try reloading the video if the initial
   * load fails.
   */
  private videoReloadInterval?: number;

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
    const isPortrait = window.innerHeight > window.innerWidth;

    const fullscreenHeight = this.clientHeight;
    // Maximum width allowed by the column layout.
    const maxWidth = this.clientWidth;

    // Adjust the image and placeholder to use the full height.
    if (this.displayContainer) {
      if (isPortrait) {
        this.displayContainer.style.height = "auto";
      } else {
        // Take up the whole viewport with the placeholder.
        this.displayContainer.style.height = `${fullscreenHeight}px`;
      }
    }
    if (this.media) {
      if (isPortrait) {
        this.media.style.height = "auto";
      } else {
        // Determine the maximum allowable height for the media that won't
        // overflow horizontally.
        const boundingRect = this.media.getBoundingClientRect();
        const maxHeight = (boundingRect.height / boundingRect.width) * maxWidth;

        this.media.style.height = `${maxHeight}px`;
      }
    }
  }

  /**
   * Sets up periodic reloading of the video.
   * @private
   */
  private setVideoReloadInterval() {
    if (this.videoReloadInterval !== undefined) {
      // It's already set up. It never actually takes this path during
      // normal operation.
      // istanbul ignore next
      return;
    }

    this.videoReloadInterval = window.setInterval(() => {
      // Clear this before reloading. It will be reset if loading the
      // video fails again.
      this.showTranscodingMessage = false;
      this.requestUpdate();
    }, 15000);
  }

  /**
   * Disables periodic reloading of the video.
   * @private
   */
  private clearVideoReloadInterval() {
    if (this.videoReloadInterval !== undefined) {
      window.clearInterval(this.videoReloadInterval);
    }
    this.videoReloadInterval = undefined;
  }

  /**
   * @inheritDoc
   */
  protected override renderVideo(): TemplateResult {
    if (!this.showTranscodingMessage) {
      this.clearVideoReloadInterval();
      return super.renderVideo();
    }

    // Rerender periodically.
    this.setVideoReloadInterval();

    // Render the transcoding message.
    return html`
      <div class="transcode_message_background">
        <div class="grid_container">
          <h1 class="grid_full_row">This video is being transcoded...</h1>
          <mwc-linear-progress
            style="width: 100%"
            class="grid_full_row"
            indeterminate
          ></mwc-linear-progress>
          <p class="grid_justify_right">In the meantime, you can press</p>
          <mwc-icon id="download_icon">download</mwc-icon>
          <p class="grid_justify_left">to download the original file.</p>
        </div>
      </div>
    `;
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

    if (_changedProperties.has("sourceUrl")) {
      this.adjustSizes();
    }

    if (this.type === ObjectType.VIDEO) {
      // Add a handler for the error event. We assume that this is because
      // the video is still being transcoded.
      this.media?.addEventListener(
        "error",
        () => (this.showTranscodingMessage = true),
        { once: true }
      );
    }
  }

  /**
   * @inheritDoc
   */
  public override disconnectedCallback() {
    // Make sure the reload interval is not running.
    this.clearVideoReloadInterval();
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
export class ConnectedLargeArtifactDisplay extends connect(
  store,
  LargeArtifactDisplay
) {
  /**
   * Name for the custom event signaling that the element is disconnected from the DOM.
   */
  static DISCONNECTED_EVENT_NAME = `${LargeArtifactDisplay.tagName}-disconnected`;

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
        ConnectedLargeArtifactDisplay.DISCONNECTED_EVENT_NAME,
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

    const entity = thumbnailGridSelectors.selectById(
      state,
      frontendId as string
    );
    if (
      !entity ||
      (entity.backendId.type === ObjectType.IMAGE &&
        entity.imageStatus !== ArtifactStatus.LOADED)
    ) {
      // Image loading has not completed yet.
      return {};
    }

    return {
      // Use the streamable URL if this is a video.
      sourceUrl:
        entity.backendId.type === ObjectType.VIDEO
          ? entity.streamableUrl
          : entity.artifactUrl,
      ...this.metadataUpdatesFromState(state),
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
    handlers[ConnectedLargeArtifactDisplay.ARTIFACT_CHANGED_EVENT_NAME] = (
      event: Event
    ) => {
      const artifactId = (event as CustomEvent<string>).detail;
      return this.type === ObjectType.IMAGE
        ? (thunkLoadImage(artifactId) as unknown as Action)
        : setVideoUrl(artifactId);
    };
    handlers[ConnectedLargeArtifactDisplay.DISCONNECTED_EVENT_NAME] = (
      event: Event
    ) => {
      const artifactId = (event as CustomEvent<string>).detail;
      return this.type === ObjectType.IMAGE
        ? (thunkClearFullSizedImages([artifactId]) as unknown as Action)
        : clearVideoUrl(artifactId);
    };
    return handlers;
  }
}
