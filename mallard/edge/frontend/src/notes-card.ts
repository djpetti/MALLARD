import { css, html, LitElement } from "lit";
import { property } from "lit/decorators.js";
import { UavImageMetadata } from "mallard-api";
import "@material/mwc-icon";
import "@material/mwc-circular-progress";

/**
 * Card that shows detailed notes for an image.
 */
export class NotesCard extends LitElement {
  static readonly tagName = "notes-card";

  static styles = css`
    .flex-container {
      display: flex;
    }

    .card {
      margin: 20px;
    }

    .card-content {
      margin-left: 20px;
      margin-right: 20px;
      min-height: 10vh;
    }

    .card-title-element {
      margin-top: 20px;
      margin-bottom: 20px;
    }

    h2 {
      font-family: Roboto;
      font-weight: 500;
    }

    #note_icon {
      margin-top: 22px;
      margin-right: 20px;
    }

    #note_text {
      color: hsl(107, 10%, 40%);
      font-family: "Roboto";
      font-weight: 300;
    }
  `;

  /**
   * Metadata structure to display information from.
   */
  @property({ attribute: false })
  metadata: UavImageMetadata | null = null;

  /**
   * @inheritDoc
   */
  protected override render(): unknown {
    return html`
      <link rel="stylesheet" href="/static/mallard-edge.css" />
      <div class="mdc-card card">
        <div class="card-content">
          ${this.metadata == null
            ? html` <!-- Show the loading indicator. -->
                <mwc-circular-progress
                  class="vertical-center"
                  indeterminate
                ></mwc-circular-progress>`
            : html` <div class="flex-container">
                  <mwc-icon id="note_icon" class="card-title-element"
                    >note_alt</mwc-icon
                  >
                  <h2 class="card-title-element">Notes</h2>
                </div>
                <p id="note_text">
                  These are some example notes. They could potentially be rather
                  long.
                </p>`}
        </div>
      </div>
    `;
  }
}
