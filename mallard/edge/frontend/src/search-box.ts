import { css, html, LitElement } from "lit";
import "@material/mwc-textfield";

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

    .autocomplete-content div {
      padding: 10px;
      cursor: pointer;
      background-color: var(--theme-whitish);
      border-bottom: 1px solid var(--theme-light-gray);
    }

    .autocomplete-content div:hover {
      /*when hovering an item:*/
      background-color: var(--theme-gray);
    }

    .autocomplete-active {
      /*when navigating through the items using the arrow keys:*/
      background-color: var(--theme-secondary-2) !important;
      color: var(--theme-whitish);
    }
  `;

  /**
   * @inheritDoc
   */
  protected override render(): unknown {
    return html`
      <div class="autocomplete">
        <mwc-textfield id="search" class="rounded" label="Search" icon="search">
        </mwc-textfield>
        <div class="autocomplete-content">
          <div>
            <strong style="color:black">Autocomplete</strong>
          </div>
        </div>
      </div>
    `;
  }
}
