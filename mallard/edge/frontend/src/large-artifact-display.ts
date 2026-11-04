import { ArtifactDisplay } from "./artifact-display";
import { css, html, TemplateResult } from "lit";
import store from "./store";
import { ArtifactStatus } from "./types";
import {
  clearVideoUrl,
  thunkSetVideoUrl,
  thumbnailGridSelectors,
  thunkClearFullSizedImages,
  thunkLoadImage,
} from "./thumbnail-grid-slice";
import { Action } from "redux";
import { ObjectType } from "mallard-api";
import { state } from "lit/decorators.js";
import "@material/web/all";
import { connectRedux } from "./connected-element";

/**
 * An element for displaying a full-sized image.
 * @customElement large-artifact-display
 */
export class LargeArtifactDisplay extends ArtifactDisplay {
  static styles = css`
    ${ArtifactDisplay.styles}

    /* Keep this breakpoint in sync with the details page grid layout. */
    @media only screen and (orientation: landscape) and (min-height: 600px) {
      :host {
        /* Extra 64px leaves room for the navigation bar. */
        height: calc(100dvh - 64px);
      }

      #media_container {
        height: 100%;
        min-height: 0;
      }

      img#media {
        /* Fit the image inside the panel without measuring its aspect ratio. */
        width: 100%;
        height: 100%;
        min-height: 0;
        object-fit: contain;
        object-position: center top;
      }
    }

    @media only screen and (orientation: portrait),
      only screen and (height < 600px) {
      :host {
        padding-right: 10px;
      }

      img#media {
        /* Fill the column even for small images while preserving aspect ratio. */
        width: 100%;
        height: auto;
        max-width: 100%;
      }

      #media_container.placeholder {
        height: calc(100dvh - 64px);
      }
    }

    :host {
      display: block;
      width: 100%;
      min-width: 0;
      /* Include the inset in the panel dimensions to avoid overflow. */
      box-sizing: border-box;
      padding-top: 10px;
      padding-left: 10px;
    }

    .transcode_message_background {
      background-color: var(--md-sys-color-on-surface-variant);
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
      color: var(--md-sys-color-background);
    }

    p {
      font-family: Roboto;
      font-size: 12pt;
      font-weight: lighter;
      color: var(--md-sys-color-background);
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
      color: var(--md-sys-color-background);
    }
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
   * Sets up periodic reloading of the video.
   * @private
   */
  private setVideoReloadInterval() {
    // istanbul ignore next
    if (this.videoReloadInterval !== undefined) {
      // It's already set up. It never actually takes this path during
      // normal operation.
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
  protected override onInvalidVideo() {
    // This error means that the video is probably still being transcoded.
    this.showTranscodingMessage = true;
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
          <md-linear-progress
            style="width: 100%"
            class="grid_full_row"
            indeterminate
          ></md-linear-progress>
          <p class="grid_justify_right">In the meantime, you can press</p>
          <md-icon id="download_icon">download</md-icon>
          <p class="grid_justify_left">to download the original file.</p>
        </div>
      </div>
    `;
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
export class ConnectedLargeArtifactDisplay extends connectRedux(
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
  override stateChanged(state: any): void {
    const frontendId = this.frontendId;
    if (!this.frontendId) {
      // We don't have any image specified, so we can't do anything.
      return;
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
      return;
    }

    this.metadataUpdatesFromState(state);
    // Use the streamable URL if this is a video.
    this.sourceUrl =
      (entity.backendId.type === ObjectType.VIDEO
        ? entity.streamableUrl
        : entity.artifactUrl) ?? undefined;
  }

  /**
   * @inheritDoc
   */
  override mapEvents(): { [p: string]: (event: Event) => Action } {
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
        : (thunkSetVideoUrl(artifactId) as unknown as Action);
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
