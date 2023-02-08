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

    .autocomplete-items {
      position: absolute;
      border: 1px solid #d4d4d4;
      border-bottom: none;
      border-top: none;
      z-index: 99;
      /*position the autocomplete items to be the same width as the container:*/
      top: 100%;
      left: 0;
      right: 0;
    }

    .autocomplete-items div {
      padding: 10px;
      cursor: pointer;
      background-color: #fff;
      border-bottom: 1px solid #d4d4d4;
    }

    .autocomplete-items div:hover {
      /*when hovering an item:*/
      background-color: #e9e9e9;
    }

    .autocomplete-active {
      /*when navigating through the items using the arrow keys:*/
      background-color: DodgerBlue !important;
      color: #ffffff;
    }
  `;

  /**
   * @inheritDoc
   */
  protected override render(): unknown {
    return html`
      <div class="autocomplete">
        <mwc-textfield
          id="search"
          class="rounded"
          label="Search"
          iconLeading="search"
        >
        </mwc-textfield>
        <div class="autocomplete-items">
          <div>
            <strong style="color:black">Autocomplete</strong>
          </div>
        </div>
      </div>
    `;
  }
}
