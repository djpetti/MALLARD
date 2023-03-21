import { css, html, LitElement } from "lit";

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
   * @inheritDoc
   */
  protected override render(): unknown {
    return html`
      <link rel="stylesheet" href="/static/mallard-edge.css" />
      <div class="mdc-card card">
        <div class="card-content">
          <div class="flex-container">
            <mwc-icon id="note_icon" class="card-title-element"
              >note_alt</mwc-icon
            >
            <h2 class="card-title-element">Notes</h2>
          </div>
          <p id="note_text">
            These are some example notes. They could potentially be rather long.
          </p>
        </div>
      </div>
    `;
  }
}
