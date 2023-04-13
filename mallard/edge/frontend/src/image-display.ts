import { css, html, PropertyValues, TemplateResult } from "lit";
import { property, query } from "lit/decorators.js";
import "@material/mwc-circular-progress";
import { ObjectRef } from "mallard-api";
import { PageManager } from "./page-manager";
import { ArtifactInfoBase } from "./artifact-info-base";

/** Type of click handler functions. */
type ClickHandler = (_: Event) => any;

/**
 * A generic element for displaying images.
 * @customElement image-display
 */
export class ImageDisplay extends ArtifactInfoBase {
  static tagName = "image-display";
  static styles = css`
    :host {
      border: none;
    }

    .placeholder {
      background-color: var(--theme-gray);
      width: 100%;
      height: 100%;
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
   * The URL of the image to display.
   */
  @property({ type: String })
  imageUrl?: string;

  /**
   * An optional location we want to take the user to when the image
   * is clicked.
   */
  @property({ type: String })
  imageLink?: string;

  /**
   * Accesses the image container element.
   * @protected
   */
  @query("#image_container")
  protected imageContainer?: HTMLDivElement;

  /**
   * Accesses the image element.
   * @protected
   */
  @query("#image")
  protected image?: HTMLImageElement;

  /**
   * Keeps track of the handler we are using for image clicks.
   */
  private clickHandler?: ClickHandler;

  /**
   * Checks if an image is set for this component.
   * @return {boolean} True iff an actual image is set in this component.
   */
  get hasImage(): boolean {
    return this.imageUrl != undefined;
  }

  /**
   * Renders a particular image, adding a link if needed.
   * @return {TemplateResult} The rendered template for the image.
   * @private
   */
  private renderImage(): TemplateResult {
    return html`<img
      id="image"
      src="${this.imageUrl as string}"
      alt="image"
    />`;
  }

  /**
   * @inheritDoc
   */
  protected override render() {
    // Only show the placeholder if we don't have an image.
    const placeholderClass = this.hasImage ? "" : "placeholder";
    // Show the loading indicator if it's enabled, and we don't have an image yet.
    const loaderClass =
      this.showLoadingAnimation && !this.hasImage ? "" : "hidden";

    return html`
      <div id="image_container" class="${placeholderClass} centered">
        <!-- Loading animation -->
        <mwc-circular-progress
          indeterminate
          class="${loaderClass}"
        ></mwc-circular-progress>

        <!-- Image -->
        ${this.hasImage ? this.renderImage() : html``}
      </div>
    `;
  }

  /**
   * @inheritDoc
   */
  protected override updated(_changedProperties: PropertyValues) {
    super.updated(_changedProperties);

    if (_changedProperties.has("imageLink") && this.hasImage) {
      const clickHandler = (_: Event) =>
        PageManager.getInstance().loadPage(this.imageLink as string);
      if (this.imageLink) {
        // Add a click handler that takes us to this location.
        this.clickHandler = clickHandler;
        (this.image as HTMLImageElement).addEventListener(
          "click",
          clickHandler
        );
      } else {
        // Remove any existing handler.
        (this.image as HTMLImageElement).removeEventListener(
          "click",
          this.clickHandler as ClickHandler
        );
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
