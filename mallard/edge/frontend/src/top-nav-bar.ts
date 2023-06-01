import { css, html, LitElement, nothing, PropertyValues } from "lit";
import { property, query } from "lit/decorators.js";
import { connect } from "@captaincodeman/redux-connect-element";
import "@material/mwc-button";
import "@material/mwc-circular-progress";
import "@material/mwc-dialog";
import "@material/mwc-top-app-bar-fixed";
import "@material/mwc-icon-button";
import "@material/mwc-textfield";
import "@material/mwc-menu";
import "./search-box";
import store from "./store";
import { RequestState, RootState } from "./types";
import { Action } from "redux";
import {
  thunkBulkDownloadSelected,
  thunkClearExportedImages,
  thunkDeleteSelected,
  thunkExportSelected,
  thunkSelectAll,
} from "./thumbnail-grid-slice";
import { Dialog } from "@material/mwc-dialog";
import { Button } from "@material/mwc-button";
import { Menu } from "@material/mwc-menu";

/**
 * Top navigation bar in the MALLARD app.
 */
export class TopNavBar extends LitElement {
  static tagName = "top-nav-bar";
  static styles = css`
    .hidden {
      display: none;
    }

    .no-overflow {
      overflow: hidden;
    }

    .relative {
      position: relative;
    }

    .normal {
      --mdc-theme-primary: var(--theme-secondary-2);
    }

    .selection-mode {
      /* Change the color slightly in selection mode to provide a cue to the
      user.
       */
      --mdc-theme-primary: var(--theme-secondary-1);
    }

    .vertical-centered {
      display: flex;
      align-items: center;
    }

    #app_bar {
      --mdc-theme-on-primary: var(--theme-whitish);
      overflow-x: hidden;
    }

    #search {
      margin-left: 250px;
      margin-top: 5px;
      position: fixed;
      /* Put the search box on top of the navigation bar. */
      top: 0;
      z-index: 10;
    }

    #title {
      margin-right: 10px;
      font-family: deftone-stylus;
      font-size: 38px;
    }
  `;

  /**
   * The name of the event to fire when the download button is clicked.
   */
  static DOWNLOAD_STARTED_EVENT_NAME = `${TopNavBar.tagName}-download-started`;

  /**
   * The name of the event to fire when the delete button is clicked.
   */
  static DELETE_EVENT_NAME = `${TopNavBar.tagName}-delete`;

  /**
   * The name of the event to fire when the URL export button is clicked.
   */
  static URL_EXPORT_EVENT_NAME = `${TopNavBar.tagName}-url-export`;

  /**
   * The name of the event to fire when the URL export is finished.
   */
  static URL_EXPORT_FINISHED_EVENT_NAME = `${TopNavBar.tagName}-url-export-finished`;

  /**
   * The name of the event to fire when the cancel selection button is clicked.
   */
  static SELECT_CANCEL_EVENT_NAME = `${TopNavBar.tagName}-select-cancel`;

  /**
   * If true, it will show the back button on the left.
   */
  @property({ type: Boolean })
  showBack: boolean = false;

  /**
   * The title of the application to show on the top bar.
   */
  @property({ type: String })
  title: string = "";

  /**
   * Total number of items that are selected.
   */
  @property({ type: Number })
  numItemsSelected: number = 0;

  /**
   * Whether to show the progress indicator in the deletion modal.
   */
  @property({ type: Boolean })
  showDeletionProgress: boolean = false;

  /**
   * Link to the exported image URL file, if we have it.
   */
  @property({ type: String })
  exportedUrlFileLink: string | null = null;

  /**
   * The deletion confirmation modal.
   */
  @query("#confirm_delete_dialog", true)
  private confirmDeleteDialog!: Dialog;

  /**
   * The "more actions" button
   */
  @query("#more_actions_button")
  private moreActionsButton?: Button;

  /**
   * The overflow actions menu.
   */
  @query("#more_actions_menu")
  private moreActionsMenu?: Menu;

  /**
   * Hidden link for downloading files.
   */
  @query("#download_link")
  private downloadLink?: HTMLElement;

  /**
   * Run when the download button is clicked.
   * @private
   */
  private onDownloadClick(): void {
    // Dispatch the event.
    this.dispatchEvent(
      new CustomEvent<void>(TopNavBar.DOWNLOAD_STARTED_EVENT_NAME, {
        bubbles: true,
        composed: false,
      })
    );
  }

  /**
   * Run when the delete button is clicked.
   * @private
   */
  private onDeleteClick(): void {
    // Dispatch the event.
    this.dispatchEvent(
      new CustomEvent<void>(TopNavBar.DELETE_EVENT_NAME, {
        bubbles: true,
        composed: false,
      })
    );
  }

  /**
   * Run when the URL export button is clicked.
   * @private
   */
  private onUrlExportClick(): void {
    // Dispatch the event.
    this.dispatchEvent(
      new CustomEvent<void>(TopNavBar.URL_EXPORT_EVENT_NAME, {
        bubbles: true,
        composed: false,
      })
    );
  }

  /**
   * Run when the cancel selection button is clicked.
   * @private
   */
  private onCancelSelectionClick(): void {
    // Dispatch the event.
    this.dispatchEvent(
      new CustomEvent<void>(TopNavBar.SELECT_CANCEL_EVENT_NAME, {
        bubbles: true,
        composed: false,
      })
    );
  }

  /**
   * @inheritDoc
   */
  protected override render(): unknown {
    // Only show the back button if that's been requested.
    const backButtonClass = this.showBack ? "" : "hidden";
    const topBarClass = this.numItemsSelected ? "selection-mode" : "normal";

    // If we have items selected, show a message about that instead of the
    // normal title.
    const title =
      this.numItemsSelected > 0
        ? html`<mwc-icon-button
              icon="close"
              id="cancel_selection"
              @click="${this.onCancelSelectionClick}"
            ></mwc-icon-button>
            ${this.numItemsSelected} Selected`
        : html`${this.title}`;

    return html`
      <link rel="stylesheet" href="/static/mallard-edge.css" />

      <mwc-top-app-bar-fixed id="app_bar" class="${topBarClass}">
        <!-- Back button -->
        <mwc-icon-button
          class="${backButtonClass}"
          icon="arrow_back"
          slot="navigationIcon"
          id="back_button"
          @click="${() => history.back()}"
        ></mwc-icon-button>
        <!-- Title -->
        <span slot="title" class="vertical-centered" id="title">
          ${title}
        </span>
        ${this.numItemsSelected == 0
          ? html` <!-- Search box. -->
              <search-box id="search"></search-box>`
          : nothing}

        <!-- Action items. -->
        ${this.numItemsSelected > 0
          ? html`
              <mwc-icon-button
                icon="download"
                slot="actionItems"
                id="download_button"
                @click="${this.onDownloadClick}"
              ></mwc-icon-button>
              <mwc-icon-button
                icon="delete_outline"
                slot="actionItems"
                id="delete_button"
                @click="${() => this.confirmDeleteDialog.show()}"
              >
              </mwc-icon-button>
              <div class="relative" slot="actionItems">
                <mwc-icon-button
                  icon="more_vert"
                  id="more_actions_button"
                  @click="${() => this.moreActionsMenu?.show()}"
                ></mwc-icon-button>
                <mwc-menu id="more_actions_menu">
                  <mwc-list-item @click="${this.onUrlExportClick}"
                    >Export URLs</mwc-list-item
                  >
                </mwc-menu>
              </div>
            `
          : nothing}

        <!-- Deletion confirmation dialog. -->
        <mwc-dialog
          heading="Confirm Deletion"
          id="confirm_delete_dialog"
          scrimClickAction="${this.showDeletionProgress ? "" : "close"}"
          escKeyAction="${this.showDeletionProgress ? "" : "close"}"
          ?open="${this.showDeletionProgress}"
        >
          <div>
            Are you sure you want to delete ${this.numItemsSelected} item(s)?
          </div>
          ${this.showDeletionProgress
            ? html`
                <div slot="primaryAction" class="no-overflow">
                  <mwc-circular-progress
                    indeterminate
                    density="-4"
                  ></mwc-circular-progress>
                </div>
              `
            : html` <mwc-button
                slot="primaryAction"
                id="delete_confirm_button"
                icon="delete"
                @click="${this.onDeleteClick}"
                >Delete</mwc-button
              >`}
          <mwc-button
            slot="secondaryAction"
            dialogAction="cancel"
            ?disabled="${this.showDeletionProgress}"
            >Cancel</mwc-button
          >
        </mwc-dialog>

        <!-- Hidden link for downloading files. -->
        ${this.exportedUrlFileLink
          ? html`<a
              id="download_link"
              class="hidden"
              href="${this.exportedUrlFileLink}"
              download
            ></a>`
          : nothing}

        <slot></slot>
      </mwc-top-app-bar-fixed>
    `;
  }

  /**
   * @inheritDoc
   */
  protected override updated(_changedProperties: PropertyValues) {
    super.updated(_changedProperties);

    if (
      _changedProperties.has("showDeletionProgress") &&
      !this.showDeletionProgress
    ) {
      // If we've stopped showing the deletion progress, go ahead and close
      // the dialog automatically.
      this.confirmDeleteDialog.close();
    }

    if (this.moreActionsMenu) {
      // If we are showing this menu, make sure it is anchored to the button.
      this.moreActionsMenu.anchor = this.moreActionsButton as Button;
    }

    if (this.downloadLink) {
      // If this is rendered, we should start the download.
      this.downloadLink.click();
      // Clean up after the download is finished.
      this.dispatchEvent(
        new CustomEvent<void>(TopNavBar.URL_EXPORT_FINISHED_EVENT_NAME, {
          bubbles: true,
          composed: false,
        })
      );
    }
  }
}

/**
 * Extension of `TopNavBar` that connects to Redux.
 */
export class ConnectedTopNavBar extends connect(store, TopNavBar) {
  /**
   * @inheritDoc
   */
  mapState(state: RootState): { [p: string]: any } {
    return {
      numItemsSelected: state.imageView.numItemsSelected,
      showDeletionProgress:
        state.imageView.imageDeletionState == RequestState.LOADING,
      exportedUrlFileLink: state.imageView.exportedImagesUrl,
    };
  }

  /**
   * @inheritDoc
   */
  mapEvents(): { [p: string]: (event: Event) => Action } {
    const handlers: { [p: string]: (event: Event) => Action } = {};

    // The fancy casting here is a hack to deal with the fact that
    // thunkBulkDownload produces an AsyncThunkAction but mapEvents is typed
    // as requiring an Action. However, it still works just fine with an
    // AsyncThunkAction.
    handlers[ConnectedTopNavBar.DOWNLOAD_STARTED_EVENT_NAME] = (_) =>
      thunkBulkDownloadSelected() as unknown as Action;
    handlers[ConnectedTopNavBar.SELECT_CANCEL_EVENT_NAME] = (_) =>
      thunkSelectAll(false) as unknown as Action;
    handlers[ConnectedTopNavBar.DELETE_EVENT_NAME] = (_) =>
      thunkDeleteSelected() as unknown as Action;
    handlers[ConnectedTopNavBar.URL_EXPORT_EVENT_NAME] = (_) =>
      thunkExportSelected() as unknown as Action;
    handlers[ConnectedTopNavBar.URL_EXPORT_FINISHED_EVENT_NAME] = (_) =>
      thunkClearExportedImages() as unknown as Action;

    return handlers;
  }
}
