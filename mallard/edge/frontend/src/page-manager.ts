import $ from "jquery";
import { TopNavBar } from "./top-nav-bar";

/**
 * In an SPA, it is sometimes convenient to have separate pages that
 * don't actually get loaded via redirects but nonetheless provide a
 * copy-and-paste-able URL. This class facilitates implementing these
 * pages, leveraging AJAX requests to load new content from the backend
 * without reloading the entire page.
 */
export class PageManager {
  /** The root element selector to use for the singleton. */
  private static ROOT_ELEMENT_SELECTOR = "#main";
  /** The top nav bar selector to use for the singleton. */
  private static TOP_NAV_BAR_SELECTOR = "#main_app_bar";

  /** The singleton instance. */
  private static instance?: PageManager;

  /** The element that encapsulates our entire page. */
  private readonly rootElementSelector: string;
  /** The top navigation bar. */
  private readonly topNavBarSelector: string;

  /**
   * @param {string} rootElementSelector Selector for the root element
   *  that encapsulates all the contents of the page. The
   *  contents of this element will be completely swapped out when a new
   *  page is loaded.
   * @param {string} topNavBarSelector Selector for the top navigation bar element.
   */
  private constructor(rootElementSelector: string, topNavBarSelector: string) {
    this.rootElementSelector = rootElementSelector;
    this.topNavBarSelector = topNavBarSelector;

    // Register a handler for the onpopstate event, which we need to catch
    // so that the app behaves intuitively when the user presses the "back"
    // button.
    window.addEventListener("popstate", (_) => this.handlePopState());
  }

  /**
   * Gets the singleton instance.
   * @return {PageManager} The singleton instance.
   */
  public static getInstance(): PageManager {
    if (!PageManager.instance) {
      // Initialize the singleton.
      PageManager.instance = new PageManager(
        PageManager.ROOT_ELEMENT_SELECTOR,
        PageManager.TOP_NAV_BAR_SELECTOR
      );
    }

    return PageManager.instance;
  }

  /**
   * Loads the contents of a new page and replaces the current one.
   * @param {string} url The URL of the new page to load.
   * @private
   */
  private replacePageContent(url: string) {
    // Load the new page data.
    const queryParams = $.param({ fragment: true });
    $(this.rootElementSelector).load(`${url}?${queryParams}`);
  }

  /**
   * Updates the URL displayed in the address bar to the new page.
   * @param {string} url The URL of the new page.
   * @private
   */
  private static updateAddressBar(url: string) {
    window.history.pushState({}, "", url);
  }

  /**
   * Handler for `onpopstate` that loads the page we went back to.
   * @private
   */
  private handlePopState() {
    // Load the previous page.
    this.replacePageContent(document.location.href);
    // Hide the back button after we go back.
    PageManager.setBackButtonDisplay(false);
  }

  /**
   * Sets whether the back button is shown on the navigation bar or not.
   * @param {boolean} show Whether to show the button.
   * @private
   */
  private static setBackButtonDisplay(show: boolean) {
    const navBar = document.querySelector(
      this.TOP_NAV_BAR_SELECTOR
    ) as TopNavBar;
    navBar.showBack = show;
  }

  /**
   * Simulates navigation to a new page specified by URL.
   * To the user, the address bar will change, and it will appear
   * that they have navigated to this page, but no reload will actually
   * be performed.
   * @param {string} url The URL of the new page to load. It must actually
   *  point to a valid page, but it can be relative.
   * @param {boolean} showBack If provided, it will show the back button on the
   *  new page.
   */
  public loadPage(url: string, showBack: boolean = true) {
    PageManager.updateAddressBar(url);
    this.replacePageContent(url);

    PageManager.setBackButtonDisplay(showBack);
  }
}
