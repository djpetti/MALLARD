import { css, html, LitElement, nothing } from "lit";
import { property } from "lit/decorators.js";
import { connect } from "@captaincodeman/redux-connect-element";
import "@material/mwc-top-app-bar-fixed";
import "@material/mwc-icon-button";
import "@material/mwc-textfield";
import "./search-box";
import store from "./store";
import { RootState } from "./types";
import { Action } from "redux";
import {
  thunkBulkDownloadSelected,
  thunkSelectAll,
} from "./thumbnail-grid-slice";

/**
 * Top navigation bar in the MALLARD app.
 */
export class TopNavBar extends LitElement {
  static tagName = "top-nav-bar";
  static styles = css`
    .hidden {
      display: none;
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
      margin-left: 200px;
      margin-top: 5px;
      position: absolute;
      /* Put the search box on top of the navigation bar. */
      top: 0;
      z-index: 10;
    }
  `;

  /**
   * The name of the event to fire when the download button is clicked.
   */
  static DOWNLOAD_STARTED_EVENT_NAME = `${TopNavBar.tagName}-download-started`;

  /**
   * THe name of the event to fire when the cancel selection button is clicked.
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
          ? html` <mwc-icon-button
              icon="download"
              slot="actionItems"
              id="download_button"
              @click="${this.onDownloadClick}"
            ></mwc-icon-button>`
          : nothing}

        <slot></slot>
      </mwc-top-app-bar-fixed>
    `;
  }

  /**
   * @inheritDoc
   */
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

    return handlers;
  }
}
