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
import { thunkBulkDownloadSelected } from "./thumbnail-grid-slice";

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
   * Whether to enable the "selected items" state.
   */
  @property({ type: Boolean })
  itemsSelected: boolean = false;

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
   * @inheritDoc
   */
  protected override render(): unknown {
    // Only show the back button if that's been requested.
    const backButtonClass = this.showBack ? "" : "hidden";
    const topBarClass = this.itemsSelected ? "selection-mode" : "normal";

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
        <span slot="title">${this.title}</span>
        <!-- Search box. -->
        <search-box id="search"></search-box>

        <!-- Action items. -->
        ${this.itemsSelected
          ? html` <mwc-icon-button
              icon="download"
              slot="actionItems"
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
      itemsSelected: state.imageView.numItemsSelected > 0,
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

    return handlers;
  }
}
