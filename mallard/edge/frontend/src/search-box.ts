import { css, html, LitElement, nothing } from "lit";
import { property } from "lit/decorators.js";
import "@material/mwc-textfield";
import "@material/mwc-list/mwc-list.js";
import "@material/mwc-list/mwc-list-item.js";
import { connect } from "@captaincodeman/redux-connect-element";
import store from "./store";
import { RootState } from "./types";
import { Action } from "redux";

/**
 * Main search box in the MALLARD app.
 */
export class SearchBox extends LitElement {
  static tagName = "search-box";

  static styles = css`
    #search {
      width: 20vw;
    }

    .autocomplete {
      position: relative;
      display: inline-block;
    }

    .autocomplete-content {
      position: absolute;
      border: 1px solid var(--theme-light-gray);
      border-bottom: none;
      border-top: none;
      z-index: 99;
      /*position the autocomplete items to be the same width as the container:*/
      top: 100%;
      left: 0;
      right: 0;
    }

    .autocomplete-background {
      background-color: var(--theme-whitish);
    }

    .autocomplete-active {
      /*when navigating through the items using the arrow keys:*/
      background-color: var(--theme-secondary-2) !important;
      color: var(--theme-whitish);
    }
  `;

  /**
   * Name for the custom event signaling that the search string has
   * changed.
   */
  static SEARCH_STRING_CHANGED_EVENT_NAME = `${SearchBox.tagName}-search-string-changed`;

  /**
   * Suggested completions that will be shown below the search bar.
   */
  @property({ type: Array })
  autocompleteSuggestions: string[] = [];

  /**
   * @inheritDoc
   */
  protected override render(): unknown {
    return html`
      <div class="autocomplete">
        <mwc-textfield id="search" class="rounded" label="Search" icon="search">
        </mwc-textfield>
        <div class="autocomplete-background">
          ${this.autocompleteSuggestions.length > 0
            ? html`<mwc-list>
                ${this.autocompleteSuggestions.map(
                  (s) => html`
                <mwc-list-item>${s}</p></mwc-list-item>
            `
                )}
              </mwc-list>`
            : nothing}
        </div>
      </div>
    `;
  }
}

/**
 * Extension of `SearchBox` that connects to Redux.
 */
export class ConnectedSearchBox extends connect(store, SearchBox) {
  /**
   * @inheritDoc
   */
  override mapState(state: RootState): { [p: string]: any } {
    const searchState = state.imageView.search;
    return {
      autocompleteSuggestions: searchState.autocompleteSuggestions,
    };
  }

  /**
   * @inheritDoc
   */
  override mapEvents(): { [p: string]: (event: Event) => Action } {
    const handlers: { [p: string]: (event: Event) => Action } = {};
  }
}
