import {css, html, LitElement, PropertyValues} from "lit";
import {property, query} from "lit/decorators.js";
import "@material/mwc-top-app-bar-fixed";
import "@material/mwc-icon-button";
import "@material/mwc-textfield";

/**
 * Top navigation bar in the MALLARD app.
 */
export class TopNavBar extends LitElement {
  static tagName = "top-nav-bar";
  static styles = css`
    .hidden {
      display: none;
    }

    #app_bar {
      --mdc-theme-primary: var(--theme-secondary-2);
      --mdc-theme-on-primary: var(--theme-whitish);

      overflow-x: hidden;
    }
    
    #search {
      margin-left: 10vw;
      width: 20vw;
    }
  `;

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

  @query("#search")
  protected search?: HTMLInputElement;

  /**
   * @inheritDoc
   */
  protected override render(): unknown {
    // Only show the back button if that's been requested.
    const backButtonClass = this.showBack ? "" : "hidden";

    return html`
      <mwc-top-app-bar-fixed id="app_bar">
        <!-- Back button -->
        <mwc-icon-button
          class="${backButtonClass}"
          icon="arrow_back"
          slot="navigationIcon"
          id="back_button"
          @click="${() => history.back()}"
        ></mwc-icon-button>
        <!-- Title and search box. -->
        <span slot="title">
          <span>${this.title}</span>
          <mwc-textfield
            id="search"
            class="rounded autocomplete"
            label="Search"
            iconLeading="search"
          ></mwc-textfield>
        </span>

        <slot></slot>
      </mwc-top-app-bar-fixed>
    `;
  }

  /**
   * @inheritDoc
   */
  protected override firstUpdated(_changedProperties: PropertyValues) {
    // Initialize autocomplete.
    M.Autocomplete.init(this.search as HTMLInputElement, {
      data: {
        "foo": null,
        "bar": null,
        "baz": null,
      }
    })

    super.firstUpdated(_changedProperties);
  }
}
