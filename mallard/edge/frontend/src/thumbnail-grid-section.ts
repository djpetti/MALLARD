import { LitElement, customElement, css, html, property } from "lit-element";
import "@material/mwc-top-app-bar";
import "./connected-artifact-thumbnail";

@customElement("thumbnail-grid-section")
/**
 * A grid of thumbnails with a section header.
 */
export class ThumbnailGridSection extends LitElement {
  static styles = css`
    :host {
      display: block;
    }

    #section_contents {
      display: grid;
      /* Default to 4/3 aspect ratio. */
      grid-template-columns: repeat(auto-fill, minmax(133px, 1fr));
      grid-gap: 0;
    }

    .section_divider {
      background-color: var(--theme-primary);
      color: var(--theme-blackish);
      padding: 1rem;
      width: 100%;
      border: none;
      text-align: left;
      outline: none;
      font-family: "Roboto";
      font-style: normal;
    }
  `;

  /**
   * The header to use for this section.
   */
  @property({ type: String })
  sectionHeader: string = "Section Header";

  /**
   * The unique IDs of the artifacts whose thumbnails are displayed in this component.
   */
  @property({ type: Array })
  displayedArtifacts: string[] = [];

  /**
   * @inheritDoc
   */
  protected render() {
    return html`
      ${this.displayedArtifacts.length == 0
        ? html`<div class="section_divider">${this.sectionHeader}</div>`
        : html``}
      <div id="section_contents">
        ${this.displayedArtifacts.map(
          (i) => html`<artifact-thumbnail .imageId=${i}></artifact-thumbnail>`
        )}
      </div>
    `;
  }
}
