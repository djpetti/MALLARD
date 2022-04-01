import { css, html, LitElement, property, PropertyValues, query } from "lit-element";
import "./thumbnail-grid";
import "./file-uploader";
import "./metadata-form";
import "@material/mwc-fab";
import "@material/mwc-dialog";
import "@material/mwc-button";
import { connect } from "@captaincodeman/redux-connect-element";
import store from "./store";
import { Action } from "redux";
import { dialogClosed, dialogOpened } from "./upload-slice";
import { RootState } from "./types";
import {ThumbnailGrid} from "./thumbnail-grid";

/**
 * This is the root element that controls the behavior of the main page of
 * the application.
 */
export class MallardApp extends LitElement {
  static tagName: string = "mallard-app";
  static styles = css`
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
  static UPLOAD_MODAL_STATE_CHANGE = `${MallardApp.tagName}-upload-modal-state-change`;

  /** Indicates whether the upload modal should be open. */
  @property()
  uploadModalOpen: boolean = false;

  /** Keeps track of whether any uploads are currently in-progress. */
  @property({ attribute: false })
  protected uploadsInProgress: boolean = false;

  @query("#thumbnails", true)
  private thumbnailGrid!: ThumbnailGrid;

  /**
   * @inheritDoc
   */
  protected override render() {
    return html`
      <link rel="stylesheet" href="./static/mallard-edge.css" />

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

        <mwc-button
          id="done_button"
          slot="primaryAction"
          @click="${() => {
            this.uploadModalOpen = false;
          }}"
        >
          Done
        </mwc-button>
      </mwc-dialog>
    `;
  }

  /**
   * @inheritDoc
   */
  protected override updated(_changedProperties: PropertyValues) {
    super.updated(_changedProperties);

    if (_changedProperties.has("uploadModalOpen")) {
      // The upload modal state has changed.
      this.dispatchEvent(
        new CustomEvent<boolean>(MallardApp.UPLOAD_MODAL_STATE_CHANGE, {
          bubbles: true,
          composed: false,
          detail: this.uploadModalOpen,
        })
      );
    }

    if (
      _changedProperties.has("uploadsInProgress") &&
      !this.uploadsInProgress
    ) {
      // If we finished some pending uploads, we should force a refresh of the
      // thumbnail grid in order to capture any new data.
      this.thumbnailGrid.refresh();
    }
  }
}

/**
 * Custom event fired when the upload modal is opened or closed. In this case,
 * the event detail is a boolean indicating whether it is open or not.
 */
type ModalStateChangedEvent = CustomEvent<boolean>;

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
    };
  }

  /**
   * @inheritDoc
   */
  override mapEvents(): { [p: string]: (event: Event) => Action } {
    const handlers: { [p: string]: (event: Event) => Action } = {};

    handlers[ConnectedMallardApp.UPLOAD_MODAL_STATE_CHANGE] = (
      event: Event
    ) => {
      return (event as ModalStateChangedEvent).detail
        ? dialogOpened(null)
        : dialogClosed(null);
    };
    return handlers;
  }
}
