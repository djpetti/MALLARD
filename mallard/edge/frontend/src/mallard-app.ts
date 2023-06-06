import { css, html, LitElement, PropertyValues } from "lit";
import { property, query } from "lit/decorators.js";
import "./thumbnail-grid";
import "./file-uploader";
import "./metadata-form";
import "@material/mwc-fab";
import "@material/mwc-dialog";
import "@material/mwc-button";
import { connect } from "@captaincodeman/redux-connect-element";
import store from "./store";
import { Action } from "redux";
import { dialogOpened, thunkFinishUpload } from "./upload-slice";
import { RootState, UploadWorkflowStatus } from "./types";
import { ThumbnailGrid } from "./thumbnail-grid";

/**
 * This is the root element that controls the behavior of the main page of
 * the application.
 */
export class MallardApp extends LitElement {
  static tagName: string = "mallard-app";
  static styles = css`
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
      --mdc-dialog-max-width: 2000px;
    }

    #upload_row {
      height: 70vh;
    }

    #upload_column {
      z-index: 20;
    }

    #metadata_column {
      margin-left: 24px;
      margin-right: -24px;
      box-shadow: inset 1px 1px 5px 1px rgba(0, 0, 0, 0.2);
      background-color: var(--theme-lighter-gray);
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
   * @inheritDoc
   */
  protected override render() {
    return html`
      <link rel="stylesheet" href="/static/mallard-edge.css" />

      <thumbnail-grid id="thumbnails"></thumbnail-grid>
      <mwc-fab
        icon="add"
        id="add_data"
        @click="${() => {
          this.uploadModalOpen = true;
        }}"
      ></mwc-fab>

      <!-- Upload modal (initially closed) -->
      <mwc-dialog
        id="upload_modal"
        heading="Upload Data"
        scrimClickAction=""
        escapeKeyAction=""
        ?open="${this.uploadModalOpen}"
      >
        <div class="row" id="upload_row">
          <div id="upload_column" class="column_width1">
            <file-uploader></file-uploader>
          </div>
          <div id="metadata_column" class="column_width1 center">
            <metadata-form></metadata-form>
          </div>
        </div>

        ${this.finalizingUploads
          ? html`
              <div slot="primaryAction" class="no-overflow">
                <mwc-circular-progress
                  indeterminate
                  density="-4"
                ></mwc-circular-progress>
              </div>
            `
          : html` <mwc-button
              id="done_button"
              slot="primaryAction"
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
            </mwc-button>`}
      </mwc-dialog>
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
export class ConnectedMallardApp extends connect(store, MallardApp) {
  /**
   * @inheritDoc
   */
  mapState(state: RootState): { [p: string]: any } {
    return {
      uploadModalOpen: state.uploads.dialogOpen,
      uploadsInProgress: state.uploads.uploadsInProgress > 0,
      finalizingUploads:
        state.uploads.status === UploadWorkflowStatus.FINALIZING,
    };
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
