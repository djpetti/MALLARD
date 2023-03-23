import { css, html } from "lit";
import { property, state } from "lit/decorators.js";
import { UavImageMetadata } from "mallard-api";
import "@material/mwc-icon";
import "@material/mwc-circular-progress";
import { ArtifactInfoBase } from "./artifact-info-base";
import { connect } from "@captaincodeman/redux-connect-element";
import store from "./store";
import { RootState } from "./types";
import { Action } from "redux";

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
   * Metadata structure to display information from.
   */
  @state()
  metadata?: UavImageMetadata;

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
                <p id="note_text">${notes}</p>`}
        </div>
      </div>
    `;
  }
}

/**
 * Extension of `NotesCard` that connects to Redux.
 */
export class ConnectedNotesCard extends connect(store, NotesCard) {
  /**
   * @inheritDoc
   */
  mapState(state: any): { [p: string]: any } {
    return this.metadataUpdatesFromState(state as RootState);
  }

  /**
   * @inheritDoc
   */
  mapEvents(): { [p: string]: (event: Event) => Action } {
    return this.metadataLoadEventHandlers();
  }
}
