import { LitElement, css, html } from "lit";
import { property } from "lit/decorators.js";
import "@material/mwc-top-app-bar";
import "./artifact-thumbnail";

/**
 * A grid of thumbnails with a section header.
 * @customElement thumbnail-grid-section
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

    #section_divider {
      background-color: var(--theme-primary);
      color: var(--theme-whitish);
      padding: 1rem;
      width: 100%;
      border: none;
      text-align: left;
      outline: none;
      font-family: "Roboto";
      font-style: normal;
    }
  `;

  /** Tag name for this element. */
  static tagName: string = "thumbnail-grid-section";

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
      ${this.displayedArtifacts.length > 0
        ? html` <div id="section_divider">${this.sectionHeader}</div>`
        : html``}
      <div id="section_contents">
        ${this.displayedArtifacts.map(
          (i) =>
            html` <artifact-thumbnail .frontendId=${i}></artifact-thumbnail>`
        )}
      </div>
    `;
  }
}
