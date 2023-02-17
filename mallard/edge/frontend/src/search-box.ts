import { css, html, LitElement, nothing } from "lit";
import { property, query, state } from "lit/decorators.js";
import "@material/mwc-textfield";
import { TextField } from "@material/mwc-textfield";
import "@material/mwc-list/mwc-list.js";
import "@material/mwc-list/mwc-list-item.js";
import "@material/mwc-icon-button";
import { connect } from "@captaincodeman/redux-connect-element";
import store from "./store";
import { RequestState, RootState } from "./types";
import { Action } from "redux";
import { clearAutocomplete, thunkDoAutocomplete } from "./thumbnail-grid-slice";
import "@material/mwc-circular-progress";
import KeyPressEvent = JQuery.KeyPressEvent;

/**
 * Main search box in the MALLARD app.
 */
export class SearchBox extends LitElement {
  static tagName = "search-box";

  static styles = css`
    #search {
      width: 20vw;
    }

    #clear_button {
      position: absolute;
      z-index: 99;
      right: 0;
      top: 4px;
      color: hsl(107, 10%, 50%);
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

  /** Whether to show the loading indicator. */
  @property({ type: Boolean })
  showProgress: boolean = false;

  /** Whether to show the clear button. */
  @state()
  showClear: boolean = false;

  @query("#search", true)
  private searchBox!: TextField;

  /**
   * Clears the search box.
   * @private
   */
  private clear(): void {
    this.searchBox.value = "";
    this.showClear = false;
    this.autocompleteSuggestions = [];
  }

  /**
   * Run whenever the user changes the text in the search box.
   * @private
   */
  private onTextChange(): void {
    // Update whether the clear button is visible.
    this.showClear = this.searchBox.value.length > 0;

    // Indicate that the text changed.
    this.dispatchEvent(
      new CustomEvent<string>(SearchBox.SEARCH_STRING_CHANGED_EVENT_NAME, {
        bubbles: true,
        composed: false,
        detail: this.searchBox.value,
      })
    );
  }

  /**
   * Run whenever a key is pressed while the search box is active.
   * @param {KeyPressEvent} event The event that occurred.
   * @private
   */
  private onKeyPress(event: KeyPressEvent): void {
    console.log(event.key);
  }

  /**
   * @inheritDoc
   */
  protected override render(): unknown {
    return html`
      <link rel="stylesheet" href="./static/mallard-edge.css" />

      <div class="autocomplete">
        <mwc-textfield
          id="search"
          class="rounded"
          label="Search"
          icon="search"
          @input="${this.onTextChange}"
          @keypress="${this.onKeyPress}"
        >
        </mwc-textfield>
        ${this.showClear
          ? html`<mwc-icon-button
              icon="close"
              id="clear_button"
              @click="${this.clear}"
            ></mwc-icon-button>`
          : nothing}

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
          ${this.showProgress
            ? html`<mwc-circular-progress
                class="center"
                indeterminate
              ></mwc-circular-progress>`
            : nothing}
        </div>
      </div>
    `;
  }
}

/**
 * Event fired when the search string is changed by the user. The detail
 * attribute contains the new search string.
 */
type SearchStringChangedEvent = CustomEvent<string>;

/**
 * Extension of `SearchBox` that connects to Redux.
 */
export class ConnectedSearchBox extends connect(store, SearchBox) {
  /** How many completion suggestions to show in the menu. */
  static NUM_SUGGESTIONS: number = 5;

  /**
   * @inheritDoc
   */
  override mapState(state: RootState): { [p: string]: any } {
    const searchState = state.imageView.search;
    return {
      autocompleteSuggestions: searchState.autocompleteSuggestions,
      showProgress: searchState.queryState == RequestState.LOADING,
    };
  }

  /**
   * @inheritDoc
   */
  override mapEvents(): { [p: string]: (event: Event) => Action } {
    const handlers: { [p: string]: (event: Event) => Action } = {};

    // The fancy casting here is a hack to deal with the fact that
    // thunkDoAutocomplete produces an AsyncThunkAction but mapEvents is
    // typed as requiring an Action. However, it still works just fine with
    // an AsyncThunkAction.
    handlers[ConnectedSearchBox.SEARCH_STRING_CHANGED_EVENT_NAME] = (
      event: Event
    ) => {
      const searchEvent = event as SearchStringChangedEvent;

      if (searchEvent.detail.length < 3) {
        // We need at least three characters for meaningful autocomplete.
        return clearAutocomplete(null);
      } else {
        return thunkDoAutocomplete({
          searchString: searchEvent.detail,
          numSuggestions: ConnectedSearchBox.NUM_SUGGESTIONS,
        }) as unknown as Action;
      }
    };

    return handlers;
  }
}
