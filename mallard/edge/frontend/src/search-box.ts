import { css, html, LitElement, nothing, PropertyValues } from "lit";
import { property, query, state } from "lit/decorators.js";
import "@material/mwc-textfield";
import { TextField } from "@material/mwc-textfield";
import "@material/mwc-list/mwc-list.js";
import "@material/mwc-list/mwc-list-item.js";
import "@material/mwc-icon-button";
import "@material/mwc-dialog";
import { connect } from "@captaincodeman/redux-connect-element";
import store from "./store";
import { RequestState, RootState } from "./types";
import { Action } from "redux";
import {
  setSearchString,
  thunkDoAutocomplete,
  thunkTextSearch,
} from "./thumbnail-grid-slice";
import "@material/mwc-circular-progress";
import "@material/mwc-button";
import {
  AutocompleteMenu,
  completeSearch,
  completeToken,
} from "./autocomplete";
import "app-datepicker";
import { Dialog } from "@material/mwc-dialog";
import { DatePicker } from "app-datepicker/dist/date-picker/date-picker";
import { trim } from "lodash";
import { PlatformType } from "mallard-api";

/**
 * Condition specified when searching by dates.
 */
enum DateCondition {
  /** We want results before this date. */
  BEFORE,
  /** We want results after this date. */
  AFTER,
  /** We want results from this exact date. */
  ON,
}

/**
 * Main search box in the MALLARD app.
 */
export class SearchBox extends LitElement {
  static readonly tagName = "search-box";

  /** Maps date conditions to directives to add to the search. */
  private static readonly dateConditionToDirective = new Map([
    [DateCondition.BEFORE, "before"],
    [DateCondition.ON, "date"],
    [DateCondition.AFTER, "after"],
  ]);

  /** Maps platform conditions to the strings that we can use in the
   *  platform directive. */
  private static readonly platformToDirectiveChoice = new Map([
    [PlatformType.GROUND, "ground"],
    [PlatformType.AERIAL, "aerial"],
  ]);

  static styles = css`
    #search {
      width: 20vw;
      min-width: 250px;
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
      width: 20vw;
      min-width: 250px;
    }

    .autocomplete-active {
      /*when navigating through the items using the arrow keys:*/
      background-color: var(--theme-secondary-2) !important;
      color: var(--theme-whitish);
    }

    app-date-picker {
      /* Use matching colors for the date picker. */
      --app-primary: var(--theme-primary);
      --app-selected-hover: var(--theme-primary);
      --app-hover: var(--theme-primary);
    }
  `;

  /**
   * Name for the custom event signaling that the search string has
   * changed.
   */
  static SEARCH_STRING_CHANGED_EVENT_NAME = `${SearchBox.tagName}-search-string-changed`;

  /**
   * Name for the custom event signaling that a search has been run.
   */
  static SEARCH_STARTED_EVENT_NAME = `${SearchBox.tagName}-search-started`;

  /** Name for the custom event signaling that the search string should be
   * cleared.
   */
  static CLEAR_SEARCH_STRING_EVENT_NAME = `${SearchBox.tagName}-clear-search-string`;

  /** Name for the custom event signaling that the autocomplete suggestions
   * should be cleared.
   */
  static HIDE_AUTOCOMPLETE_EVENT_NAME = `${SearchBox.tagName}-hide-autocomplete`;

  /**
   * Suggested completions that will be shown below the search bar.
   */
  @property({ type: Array })
  autocompleteSuggestions: string[] = [];

  /** Whether to show the loading indicator. */
  @property({ type: Boolean })
  showProgress: boolean = false;

  /** The string to show in the search box. */
  @property()
  searchString: string = "";

  /** Which autocomplete menu to show. */
  @property({ attribute: false })
  autocompleteMenu: AutocompleteMenu = AutocompleteMenu.NONE;

  /** Whether to show the clear button. */
  @state()
  showClear: boolean = false;

  @query("#search", true)
  private searchBox!: TextField;

  @query("#date_picker_dialog", true)
  private datePickerDialog!: Dialog;

  @query("#date_picker", true)
  private datePicker!: DatePicker;

  /** Keeps track of which date condition the user selected. */
  private selectedDateCondition: DateCondition = DateCondition.ON;

  /**
   * Clears the search box.
   * @private
   */
  private clear(): void {
    this.dispatchEvent(
      new CustomEvent(SearchBox.CLEAR_SEARCH_STRING_EVENT_NAME, {
        bubbles: true,
        composed: false,
      })
    );
  }

  /**
   * Run whenever the user changes the text in the search box.
   * @private
   */
  private onTextChange(): void {
    // Indicate that the text changed.
    this.dispatchEvent(
      new CustomEvent<string>(SearchBox.SEARCH_STRING_CHANGED_EVENT_NAME, {
        bubbles: true,
        composed: false,
        detail: this.searchBox.value.trim(),
      })
    );
  }

  /**
   * Performs a search by firing the proper events.
   * @private
   */
  private startSearch(): void {
    this.dispatchEvent(
      new CustomEvent<string>(SearchBox.SEARCH_STARTED_EVENT_NAME, {
        bubbles: true,
        composed: false,
        detail: this.searchBox.value.trim(),
      })
    );

    // Also, once the search has been run, we should not show suggestions
    // anymore.
    this.dispatchEvent(
      new CustomEvent(SearchBox.HIDE_AUTOCOMPLETE_EVENT_NAME, {
        bubbles: true,
        composed: false,
      })
    );
  }

  /**
   * Run whenever a key is pressed while the search box is active.
   * @param {KeyboardEvent} event The event that occurred.
   * @private
   */
  private onKeyPress(event: KeyboardEvent): void {
    if (event.key == "Enter") {
      // We should perform the actual search.
      this.startSearch();
    }
  }

  /**
   * Run whenever a date condition button is clicked.
   * @param {condition} condition The button that was clicked.
   * @private
   */
  private onDateConditionClick(condition: DateCondition): void {
    this.selectedDateCondition = condition;
    this.datePickerDialog.show();
  }

  /**
   * Adds a new token to the end of the current search string.
   * @param {string} newToken The new token to add.
   * @private
   */
  private addTokenToSearchString(newToken: string): void {
    this.searchBox.value = completeToken(this.searchBox.value, newToken);
    // Manually fire this event so that it updates the autocomplete.
    this.dispatchEvent(
      new CustomEvent<string>(SearchBox.SEARCH_STRING_CHANGED_EVENT_NAME, {
        bubbles: true,
        composed: false,
        detail: this.searchBox.value.trim(),
      })
    );
  }

  /**
   * Runs whenever a platform condition button is clicked.
   * @param {PlatformType} platform The button that was clicked.
   * @private
   */
  private onPlatformConditionClick(platform: PlatformType): void {
    // Find the right directive for the platform condition.
    const platformName = SearchBox.platformToDirectiveChoice.get(platform);

    // Add it to the search string.
    const newToken = `platform:${platformName}`;
    this.addTokenToSearchString(newToken);
  }

  /**
   * Run whenever the user clicks "ok" in the date picker. It modifies
   * the search correctly for the specified date condition.
   * @private
   */
  private onDateSelected(): void {
    // Get the current date selection.
    const selectedDate = this.datePicker.value;
    // Find the right directive for the date condition.
    const directive = SearchBox.dateConditionToDirective.get(
      this.selectedDateCondition
    );

    // Add it to the search string.
    const newToken = `${directive}:${selectedDate}`;
    this.addTokenToSearchString(newToken);
  }

  /**
   * Run whenever the user clicks on an autocomplete suggestion.
   * @param {MouseEvent} event The click event.
   * @private
   */
  private onSuggestionClicked(event: MouseEvent): void {
    let suggestion = (event.target as HTMLElement).innerText;
    // Remove any ellipses.
    suggestion = trim(suggestion, ".");

    // Perform the search.
    this.searchBox.value = completeSearch(this.searchBox.value, suggestion);
    this.startSearch();
  }

  /**
   * Renders the HTML for the autocomplete menu.
   * @private
   * @return {unknown} The HTML that it rendered.
   */
  private renderAutocompleteMenu(): unknown {
    switch (this.autocompleteMenu) {
      case AutocompleteMenu.NONE:
        return nothing;

      case AutocompleteMenu.DATE:
        return html`<mwc-list-item class="center">
          <mwc-button
            dense
            unelevated
            label="before"
            @click="${() => this.onDateConditionClick(DateCondition.BEFORE)}"
          ></mwc-button>
          <mwc-button
            dense
            unelevated
            label="date"
            @click="${() => this.onDateConditionClick(DateCondition.ON)}"
          ></mwc-button>
          <mwc-button
            dense
            unelevated
            label="after"
            @click="${() => this.onDateConditionClick(DateCondition.AFTER)}"
          ></mwc-button>
        </mwc-list-item>`;

      case AutocompleteMenu.PLATFORM:
        return html`<mwc-list-item class="center">
          <mwc-button
            dense
            unelevated
            label="ground"
            @click="${() => this.onPlatformConditionClick(PlatformType.GROUND)}"
          ></mwc-button>
          <mwc-button
            dense
            unelevated
            label="aerial"
            @click="${() => this.onPlatformConditionClick(PlatformType.AERIAL)}"
          ></mwc-button>
        </mwc-list-item>`;
    }
  }

  /**
   * Determines whether we should be displaying the autocomplete dropdown.
   * @private
   * @return {boolean} True if we should show it.
   */
  private get showAutocomplete(): boolean {
    return (
      this.autocompleteSuggestions.length > 0 ||
      this.autocompleteMenu != AutocompleteMenu.NONE
    );
  }

  /**
   * @inheritDoc
   */
  protected override render(): unknown {
    return html`
      <link rel="stylesheet" href="/static/mallard-edge.css" />

      <div class="autocomplete">
        <mwc-textfield
          id="search"
          class="rounded"
          label="Search"
          icon="search"
          value="${this.searchString}"
          @input="${this.onTextChange}"
          @keypress="${this.onKeyPress}"
        >
        </mwc-textfield>
        <!-- Dialog for picking dates. -->
        <mwc-dialog id="date_picker_dialog" heading="Select Date">
          <app-date-picker min="1970-01-01" id="date_picker"></app-date-picker>
          <mwc-button
            slot="primaryAction"
            dialogAction="ok"
            @click="${this.onDateSelected}"
            >OK</mwc-button
          >
          <mwc-button slot="secondaryAction" dialogAction="cancel"
            >Cancel</mwc-button
          >
        </mwc-dialog>
        ${this.showClear
          ? html`<mwc-icon-button
              icon="close"
              id="clear_button"
              @click="${this.clear}"
            ></mwc-icon-button>`
          : nothing}

        <div class="autocomplete-background">
          ${this.showAutocomplete
            ? html`<mwc-list>
                ${this.renderAutocompleteMenu()}
                ${this.autocompleteSuggestions.map(
                  (s) => html`
                <mwc-list-item @click="${this.onSuggestionClicked}">${s}</p></mwc-list-item>
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

  /**
   * @inheritDoc
   */
  protected override updated(_changedProperties: PropertyValues) {
    super.updated(_changedProperties);

    if (_changedProperties.has("searchString")) {
      // Update the value in the text box.
      this.searchBox.value = this.searchString;
    }
  }
}

/**
 * Event fired when the search string is changed by the user. The detail
 * attribute contains the new search string.
 */
type SearchStringChangedEvent = CustomEvent<string>;

/**
 * Event fired when a search is initiated by the user. The detail attribute
 * contains the search string.
 */
type SearchStartedEvent = CustomEvent<string>;

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
      autocompleteSuggestions:
        searchState.autocompleteSuggestions.textCompletions,
      autocompleteMenu: searchState.autocompleteSuggestions.menu,
      showProgress: searchState.queryState == RequestState.LOADING,
      searchString: searchState.searchString,
      showClear: searchState.searchString.length > 0,
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
        return setSearchString({
          searchString: searchEvent.detail,
          clearAutocomplete: true,
        });
      } else {
        return thunkDoAutocomplete({
          searchString: searchEvent.detail,
          numSuggestions: ConnectedSearchBox.NUM_SUGGESTIONS,
        }) as unknown as Action;
      }
    };
    handlers[ConnectedSearchBox.SEARCH_STARTED_EVENT_NAME] = (event: Event) =>
      thunkTextSearch(
        (event as SearchStartedEvent).detail
      ) as unknown as Action;
    handlers[ConnectedSearchBox.HIDE_AUTOCOMPLETE_EVENT_NAME] = (_: Event) =>
      setSearchString({ clearAutocomplete: true });
    handlers[ConnectedSearchBox.CLEAR_SEARCH_STRING_EVENT_NAME] = (_: Event) =>
      setSearchString({ searchString: "", clearAutocomplete: true });

    return handlers;
  }
}
