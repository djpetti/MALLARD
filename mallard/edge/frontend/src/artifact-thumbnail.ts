import {
  css,
  html,
  LitElement,
  property,
  PropertyValues,
} from "lit-element";

/**
 * Thumbnail representation of an uploaded artifact.
 */
export class ArtifactThumbnail extends LitElement {
  static styles = css`
    :host {
      display: inline-block;
      border: none;
      margin: 0.5rem;
      background-color: var(--theme-gray);
      min-width: 128px;
      min-height: 80px;
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
    return html`
      <div id="image_container">
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
