import { css, html, LitElement } from "lit";
import { property } from "lit/decorators.js";
import "@material/mwc-icon/mwc-icon.js";
import "@material/mwc-list";
import "./large-image-display";

/**
 * This is the main element for the details page.
 */
export class ArtifactDetails extends LitElement {
  static readonly tagName: string = "artifact-details";

  static styles = css`
    .grid-layout {
      display: grid;
    }

    /* The main image panel. */
    .main-panel {
      grid-column-start: 1;
      grid-column-end: 3;
    }

    /* The side panel. */
    .side-panel {
      grid-column-start: 3;
      grid-column-end: 4;
      max-width: 25vw;
    }
  `;

  /**
   * The bucket that this image is in on the backend.
   */
  @property({ type: String })
  backendBucket?: string;

  /**
   * The UUID of this image on the backend.
   */
  @property({ type: String })
  backendName?: string;

  /**
   * @inheritDoc
   */
  protected override render() {
    if (!this.backendBucket || !this.backendName) {
      // Don't render anything.
      return html``;
    }

    return html`
      <div class="grid-layout">
        <div class="main-panel">
          <large-image-display
            backendBucket="${this.backendBucket}"
            backendName="${this.backendName}"
          ></large-image-display>
        </div>
        <div class="side-panel">
          <metadata-card></metadata-card>
          <notes-card></notes-card>
        </div>
      </div>
    `;
  }
}
