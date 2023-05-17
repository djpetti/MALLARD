import { LitElement, PropertyValues } from "lit";

/**
 * A superclass for elements that need to be infinitely
 * scrollable.
 */
export abstract class InfiniteScrollingElement extends LitElement {
  /** Observer to use for reacting to size changes. */
  private resizeObserver?: ResizeObserver;

  /**
   * We load some additional content beyond what will fit on the user's
   * screen as a buffer for when the user scrolls. This sets the percentage
   * of the viewport size that we want to use for the buffer size.
   * @private
   */
  private OVERFILL_MARGIN_PERCENT = 50;

  /**
   * Should trigger the load of the next section of content for
   * this element. The subclass element is responsible for
   * figuring out which content to load and correctly rendering it.
   * @return {boolean} True if content was successfully loaded, false
   *  if there was no more content to load.
   * @protected
   */
  protected abstract loadNextSection(): boolean;

  /**
   * @return {boolean} True if this element is currently
   * in the process of loading or processing new data. Basically, it
   * will check this before it kicks off a new loading cycle.
   * @protected
   */
  protected abstract isBusy(): boolean;

  /**
   * Gets the element to use when measuring the height for the purposes
   * of determining when to load more content. By default, it measures the
   * entire element, but you might just want to look at a sub-element.
   * @return {HTMLElement} The element to measure.
   * @protected
   */
  protected getContentElement(): HTMLElement {
    // This is just a default, and isn't worth testing.
    // istanbul ignore next
    return this;
  }

  /**
   * Determines if enough content has been loaded on the page.
   * @return {boolean} True if sufficient content has been loaded, false
   *  if we should load some more.
   * @private
   */
  private isEnoughLoaded(): boolean {
    const content = this.getContentElement();
    // The height of the displayed portion of the element.
    const viewportHeight = this.clientHeight;
    // The full height of the element.
    const contentHeight = content.scrollHeight;
    // How far the element is scrolled.
    const scrollDistance = this.scrollTop;

    // Compute how many pixels worth of content beyond the
    // user's current position we want to have loaded.
    const bufferSizePx = (viewportHeight * this.OVERFILL_MARGIN_PERCENT) / 100;
    // Find out how many we actually have loaded.
    const bufferUsedPx = contentHeight - (scrollDistance + viewportHeight);

    return bufferUsedPx >= bufferSizePx;
  }

  /**
   * Loads additional content until we have enough.
   */
  public loadContentWhileNeeded(): void {
    while (!this.isBusy() && !this.isEnoughLoaded()) {
      if (!this.loadNextSection()) {
        break;
      }
    }
  }

  /**
   * @inheritDoc
   */
  protected firstUpdated(_: PropertyValues) {
    // Add a handler for scroll events which loads more
    // content if needed.
    this.addEventListener("scroll", (_) => this.loadContentWhileNeeded());

    // Add a resize observer so that we can try loading more data whenever
    // the element size changes.
    this.resizeObserver = new ResizeObserver((_, __) =>
      this.loadContentWhileNeeded()
    );
    this.resizeObserver.observe(this.getContentElement());
  }
}
