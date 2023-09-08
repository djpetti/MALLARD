import { css, html, nothing, PropertyValues, TemplateResult } from "lit";
import { property, query } from "lit/decorators.js";
import "@material/mwc-circular-progress";
import "@material/mwc-icon";
import { ObjectRef, ObjectType } from "mallard-api";
import { PageManager } from "./page-manager";
import { ArtifactInfoBase } from "./artifact-info-base";

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
      background-color: var(--theme-gray);
      width: 100%;
      height: 100%;

      /** Center the contents. */
      display: flex;
      justify-content: center;
      align-items: center;
    }

    .placeholder_icon {
      color: var(--theme-whitish);
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
   * Checks if any content is set for this component.
   * @return {boolean} True iff an actual image is set in this component.
   */
  get hasContent(): boolean {
    return this.sourceUrl != undefined;
  }

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
    return html`<video
      controls
      id="media"
      src="${this.sourceUrl as string}"
    ></video>`;
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
          ? html`<mwc-icon class="placeholder_icon">movie</mwc-icon>`
          : nothing}
        <!-- Loading animation -->
        <mwc-circular-progress
          indeterminate
          class="${loaderClass}"
        ></mwc-circular-progress>

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
      if (this.onClickLink) {
        // Add a click handler that takes us to this location.
        this.clickHandler = clickHandler;
        this.addEventListener("click", clickHandler);
      } else {
        // Remove any existing handler.
        this.removeEventListener("click", this.clickHandler as ClickHandler);
      }
    }
  }
}

/**
 * The various ways that we can identify an image.
 */
export interface ImageIdentifier {
  frontendId?: string;
  backendId?: ObjectRef;
}
