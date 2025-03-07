import { css, html } from "lit";
import "@material/mwc-icon";
import "@material/web/all";
import { ArtifactInfoBase } from "./artifact-info-base";
import store, { RootState } from "./store";
import { Action } from "redux";
import { connectRedux } from "./connected-element";

/**
 * Card that shows detailed notes for an image.
 */
export class NotesCard extends ArtifactInfoBase {
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
   * @inheritDoc
   */
  protected override render(): unknown {
    let notes = this.metadata?.notes;
    if (!notes) {
      notes = "No notes.";
    }

    return html`
      <link rel="stylesheet" href="/static/mallard-edge.css" />
      <div class="mdc-card card">
        <div class="card-content">
          ${this.metadata === undefined
            ? html` <!-- Show the loading indicator. -->
                <md-circular-progress
                  class="vertical-center"
                  indeterminate
                ></md-circular-progress>`
            : html` <div class="flex-container">
                  <mwc-icon id="note_icon" class="card-title-element"
                    >note_alt</mwc-icon
                  >
                  <h2 class="card-title-element">Notes</h2>
                </div>
                <p id="note_text">${notes}</p>`}
        </div>
      </div>
    `;
  }
}

/**
 * Extension of `NotesCard` that connects to Redux.
 */
export class ConnectedNotesCard extends connectRedux(store, NotesCard) {
  /**
   * @inheritDoc
   */
  override stateChanged(state: any): void {
    this.metadataUpdatesFromState(state as RootState);
  }

  /**
   * @inheritDoc
   */
  mapEvents(): { [p: string]: (event: Event) => Action } {
    return this.metadataLoadEventHandlers();
  }
}
