import {
  css,
  html,
  LitElement,
  property,
  PropertyValues,
  TemplateResult,
} from "lit-element";
import "@material/mwc-circular-progress";
import { ObjectRef } from "typescript-axios";
import { query } from "lit-element/lib/decorators.js";

/**
 * A generic element for displaying images.
 * @customElement image-display
 */
export class ImageDisplay extends LitElement {
  static tagName = "image-display";
  static styles = css`
    :host {
      border: none;
    }

    .placeholder {
      background-color: var(--theme-gray);
      width: 100%;
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
    }
  `;

  /**
   * The name of the event to fire when the `imageId` property is changed.
   */
  static IMAGE_CHANGED_EVENT_NAME = "image-changed";

  /**
   * The unique ID of the artifact being displayed here.
   */
  @property({ type: String })
  frontendId?: string;

  /**
   * If true, it will show a loading indicator while the image loads.
   */
  @property({ type: Boolean })
  showLoadingAnimation: boolean = false;

  /**
   * The URL of the image to display.
   */
  @property({ type: String, attribute: false })
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
    let imageTemplate = html`<img
      id="image"
      src="${this.imageUrl as string}"
      alt="image"
    />`;
    if (this.imageLink) {
      // Make the image link to something.
      imageTemplate = html`<a href="${this.imageLink}">${imageTemplate}</a>`;
    }

    return imageTemplate;
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
    if (_changedProperties.has("frontendId")) {
      // The image ID has changed. We need to fire an event for this to kick
      // off the actual thumbnail load.
      this.dispatchEvent(
        new CustomEvent<ImageIdentifier>(
          ImageDisplay.IMAGE_CHANGED_EVENT_NAME,
          {
            bubbles: true,
            composed: false,
            detail: { frontendId: this.frontendId },
          }
        )
      );
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

/**
 * Interface for the custom event we dispatch when the image
 * is changed.
 */
export interface ImageChangedEvent extends Event {
  detail: ImageIdentifier;
}
