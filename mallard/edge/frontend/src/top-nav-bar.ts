import { css, html, LitElement } from "lit";
import { property } from "lit/decorators.js";
import "@material/mwc-top-app-bar-fixed";
import "@material/mwc-icon-button";
import "@material/mwc-textfield";
import "./search-box";

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
      margin-left: 200px;
      margin-top: 5px;
      position: absolute;
      /* Put the search box on top of the navigation bar. */
      top: 0;
      z-index: 10;
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
        <!-- Title -->
        <span slot="title">${this.title}</span>
        <!-- Search box. -->
        <search-box id="search"></search-box>

        <slot></slot>
      </mwc-top-app-bar-fixed>
    `;
  }

  /**
   * @inheritDoc
   */
}
