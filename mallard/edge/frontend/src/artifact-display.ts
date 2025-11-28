import { css, html, nothing, PropertyValues, TemplateResult } from "lit";
import { property, query } from "lit/decorators.js";
import "@material/web/all";
import { ObjectType, UavVideoMetadata } from "mallard-api";
import { PageManager } from "./page-manager";
import { ArtifactInfoBase } from "./artifact-info-base";
import "vidstack/bundle";
import { MediaErrorEvent } from "vidstack";

/** Type of click handler functions. */
type ClickHandler = (_: Event) => any;

/**
 * A generic element for displaying images.
 * @customElement image-display
 */
export class ArtifactDisplay extends ArtifactInfoBase {
  static tagName = "artifact-display";
  static styles = css`
    :host {
      border: none;
    }

    .placeholder {
      background-color: var(--md-sys-color-surface-dim);
      width: 100%;
      height: 100%;

      /** Center the contents. */
      display: flex;
      justify-content: center;
      align-items: center;
    }

    .placeholder_icon {
      color: var(--md-sys-color-background);
      --mdc-icon-size: 48px;
    }

    .centered {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1ch;
    }

    .hidden {
      display: none;
    }

    media-player {
      /* Align videos with the metadata cards. */
      margin-top: 20px;
    }

    img {
      display: block;
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      position: relative;
      object-position: 50% top;
    }
  `;

  /**
   * If true, it will show a loading indicator while the image loads.
   */
  @property({ type: Boolean })
  showLoadingAnimation: boolean = false;

  /**
   * The URL of the artifact to display.
   */
  @property({ type: String })
  sourceUrl?: string;

  /**
   * An optional location we want to take the user to when the display
   * is clicked.
   */
  @property({ type: String })
  onClickLink?: string;

  /**
   * Accesses the display container element.
   * @protected
   */
  @query("#media_container")
  protected displayContainer?: HTMLDivElement;

  /**
   * Accesses the image or video element, if present.
   * @protected
   */
  @query("#media")
  protected media?: HTMLImageElement | HTMLVideoElement;

  /**
   * Keeps track of the handler we are using for image clicks.
   */
  private clickHandler?: ClickHandler;

  /**
   * Abort controller to use for removing the click handler.
   */
  private clickHandlerAbortController?: AbortController;

  /**
   * Handler for the `MediaPlayer` error event.
   * @param {MediaErrorEvent} event The event object.
   * @private
   */
  private onVideoError(event: MediaErrorEvent) {
    if (event.detail.code === 4) {
      // Invalid video.
      this.onInvalidVideo();
    } else {
      // istanbul ignore next
      console.error(`Error loading video: ${event.detail.message}`);
    }
  }

  /**
   * Checks if any content is set for this component.
   * @return {boolean} True iff an actual image is set in this component.
   */
  get hasContent(): boolean {
    return this.sourceUrl != undefined;
  }

  /**
   * Function that is called when the requested video is invalid. By default,
   * it does nothing, but subclasses can override.
   * @protected
   */
  protected onInvalidVideo() {}

  /**
   * Renders a particular image.
   * @return {TemplateResult} The rendered template for the image.
   * @private
   */
  protected renderImage(): TemplateResult {
    return html`<img
      id="media"
      src="${this.sourceUrl as string}"
      alt="image"
    />`;
  }

  /**
   * Renders a particular video.
   * @return {TemplateResult} The rendered template for the video.
   */
  protected renderVideo(): TemplateResult {
    // Calculate video duration in seconds.
    const videoMetadata = this.metadata as UavVideoMetadata;
    const videoDuration =
      (videoMetadata?.numFrames ?? 0) / (videoMetadata?.frameRate ?? 30);
    return html`
      <link rel="stylesheet" href="/static/mallard-edge.css" />

      <media-player
        title="${this.metadata?.name ?? "Video"}"
        id="media"
        src="${this.sourceUrl as string}"
        type="video/webm"
        duration="${videoDuration}"
        streamType="on-demand"
        load="eager"
        @error="${this.onVideoError}"
      >
        <media-provider></media-provider>
        <media-video-layout></media-video-layout>
      </media-player>
    `;
  }

  /**
   * Renders the contents of the artifact.
   * @protected
   * @return {TemplateResult} The HTML for rendering the artifact.
   */
  protected renderArtifact(): TemplateResult {
    return html`
      ${this.type === ObjectType.IMAGE
        ? this.renderImage()
        : this.renderVideo()}
    `;
  }

  /**
   * @inheritDoc
   */
  protected override render() {
    // Only show the placeholder if we don't have an image.
    const placeholderClass = this.hasContent ? "" : "placeholder";
    // Show the loading indicator if it's enabled, and we don't have an image yet.
    const loaderClass =
      this.showLoadingAnimation && !this.hasContent ? "" : "hidden";
    const showVideoPlaceholder =
      this.type === ObjectType.VIDEO &&
      !this.hasContent &&
      !this.showLoadingAnimation;

    return html`
      <div id="media_container" class="${placeholderClass} centered">
        <!-- Placeholder icon to differentiate videos. -->
        ${showVideoPlaceholder
          ? html`<md-icon class="placeholder_icon">movie</md-icon>`
          : nothing}
        <!-- Loading animation -->
        <md-circular-progress
          indeterminate
          class="${loaderClass}"
        ></md-circular-progress>

        <!-- Image/video -->
        ${this.hasContent ? this.renderArtifact() : nothing}
      </div>
    `;
  }

  /**
   * @inheritDoc
   */
  protected override updated(_changedProperties: PropertyValues) {
    super.updated(_changedProperties);

    if (_changedProperties.has("onClickLink") && this.hasContent) {
      const clickHandler = (_: Event) =>
        PageManager.getInstance().loadPage(this.onClickLink as string);

      // Remove the previous click handler, if any.
      if (this.clickHandlerAbortController) {
        this.clickHandlerAbortController.abort();
        this.clickHandlerAbortController = undefined;
        this.clickHandler = undefined;
      }

      if (this.onClickLink) {
        // Add a click handler that takes us to this location.
        this.clickHandler = clickHandler;
        this.clickHandlerAbortController = new AbortController();
        this.addEventListener("click", clickHandler, {
          signal: this.clickHandlerAbortController.signal,
        });
      }
    }
  }
}
