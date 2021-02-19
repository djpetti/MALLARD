import { LitElement, customElement, css, html } from "lit-element";

@customElement("artifact-thumbnail")
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
      min-width: 133px;
      min-height: 80px;
    }
  `;

  /**
   * @inheritDoc
   */
  protected render() {
    return html`<div><slot></slot></div>`;
  }
}
