import { css, html, LitElement, PropertyValues } from "lit";
import { property, query } from "lit/decorators.js";
import "./thumbnail-grid";
import "./file-uploader";
import "./metadata-form";
import "@material/web/all";
import store, { RootState } from "./store";
import { Action } from "redux";
import { dialogOpened, thunkFinishUpload } from "./upload-slice";
import { UploadWorkflowStatus } from "./types";
import { ThumbnailGrid } from "./thumbnail-grid";
import { connectRedux } from "./connected-element";

/**
 * This is the root element that controls the behavior of the main page of
 * the application.
 */
export class MallardApp extends LitElement {
  static tagName: string = "mallard-app";
  static styles = css`
    :host {
      --md-circular-progress-size: 32px;
    }

    .no-overflow {
      overflow: hidden;
    }

    #thumbnails {
      overflow-x: hidden;
    }

    #add_data {
      /* Position in bottom right. */
      position: fixed;
      bottom: 0;
      right: 0;
      padding: 20pt;
    }

    #upload_modal {
      /** Provide for two-column layout. */
      max-width: 2000px;
      max-height: 100%;
    }

    #upload_row {
      height: 70vh;
    }

    #upload_column {
      max-height: 100%;
    }

    #metadata_column {
      margin-left: 24px;
    }
  `;

  /** Name for the custom event signaling that the upload modal has been
   * opened or closed.
   */
  static UPLOAD_MODAL_OPEN_EVENT_NAME = `${MallardApp.tagName}-upload-modal-state-change`;

  /** Name for the custom event signaling that the user has clicked the Done
   * button on the upload modal.
   */
  static DONE_BUTTON_EVENT_NAME = `${MallardApp.tagName}-done-button-clicked`;

  /** Indicates whether the upload modal should be open. */
  @property({ type: Boolean })
  uploadModalOpen: boolean = false;

  /** Keeps track of whether any uploads are currently in-progress. */
  @property({ attribute: false })
  uploadsInProgress: boolean = false;

  /** Keeps track of whether uploads are currently being finalized. */
  @property({ attribute: false })
  finalizingUploads: boolean = false;

  @query("#thumbnails", true)
  private thumbnailGrid!: ThumbnailGrid;

  /**
   * Prevents the dialog from closing unless the element state reflects this.
   * @param {Event} event The close event.
   * @private
   */
  private onDialogCloseEvent(event: Event): void {
    if (this.uploadModalOpen) {
      event.preventDefault();
    }
  }

  /**
   * @inheritDoc
   */
  protected override render() {
    return html`
      <link rel="stylesheet" href="/static/mallard-edge.css" />

      <thumbnail-grid id="thumbnails"></thumbnail-grid>
      <md-fab
        id="add_data"
        @click="${() => {
          this.uploadModalOpen = true;
        }}"
      >
        <md-icon slot="icon">add</md-icon>
      </md-fab>

      <!-- Upload modal (initially closed) -->
      <md-dialog
        id="upload_modal"
        ?open="${this.uploadModalOpen}"
        @close="${this.onDialogCloseEvent}"
      >
        <div slot="headline">Upload Data</div>
        <div slot="content" class="row" id="upload_row">
          <div id="upload_column" class="column_width1">
            <file-uploader></file-uploader>
          </div>
          <div id="metadata_column" class="column_width1 center">
            <metadata-form></metadata-form>
          </div>
        </div>

        <div slot="actions">
          ${this.finalizingUploads
            ? html`
                <div class="no-overflow">
                  <md-circular-progress indeterminate></md-circular-progress>
                </div>
              `
            : html` <md-text-button
                id="done_button"
                ?disabled="${this.uploadsInProgress}"
                @click="${() => {
                  this.dispatchEvent(
                    new CustomEvent(MallardApp.DONE_BUTTON_EVENT_NAME, {
                      bubbles: true,
                      composed: false,
                    })
                  );
                }}"
              >
                Done
              </md-text-button>`}
        </div>
      </md-dialog>
    `;
  }

  /**
   * @inheritDoc
   */
  protected override updated(_changedProperties: PropertyValues) {
    super.updated(_changedProperties);

    if (_changedProperties.get("uploadModalOpen") !== undefined) {
      if (this.uploadModalOpen) {
        // The upload modal has been opened.
        this.dispatchEvent(
          new CustomEvent(MallardApp.UPLOAD_MODAL_OPEN_EVENT_NAME, {
            bubbles: true,
            composed: false,
          })
        );
      } else {
        // When we close the modal, force the image view to try to reload
        // additional data.
        this.thumbnailGrid.loadContentWhileNeeded();
      }
    }
  }
}

/**
 * Extension of `Application` that connects to Redux.
 */
export class ConnectedMallardApp extends connectRedux(store, MallardApp) {
  /**
   * @inheritDoc
   */
  override stateChanged(state: RootState): void {
    this.uploadModalOpen = state.uploads.dialogOpen;
    this.uploadsInProgress = state.uploads.uploadsInProgress > 0;
    this.finalizingUploads =
      state.uploads.status === UploadWorkflowStatus.FINALIZING;
  }

  /**
   * @inheritDoc
   */
  override mapEvents(): { [p: string]: (event: Event) => Action } {
    const handlers: { [p: string]: (event: Event) => Action } = {};

    handlers[ConnectedMallardApp.UPLOAD_MODAL_OPEN_EVENT_NAME] = (_: Event) =>
      dialogOpened();
    handlers[ConnectedMallardApp.DONE_BUTTON_EVENT_NAME] = (_: Event) =>
      thunkFinishUpload() as unknown as Action;
    return handlers;
  }
}
