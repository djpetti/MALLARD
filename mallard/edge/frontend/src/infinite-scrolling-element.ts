import { LitElement, PropertyValues } from "lit";

/**
 * A superclass for elements that need to be infinitely
 * scrollable.
 */
export abstract class InfiniteScrollingElement extends LitElement {
  /**
   * We load some additional content beyond what will fit on the user's
   * screen as a buffer for when the user scrolls. This sets the percentage
   * of the viewport size that we want to use for the buffer size.
   * @private
   */
  private readonly OVERFILL_MARGIN_PERCENT = 50;
  /**
   * This denotes the maximum amount of extra content we want to keep before
   * and after the user's screen as a buffer for when the user scrolls. This
   * is set as a percentage of the viewport size.
   */
  private readonly MAXIMUM_OVERFILL_PERCENT = 200;

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
   * Should trigger the load of the previous section of content for
   * this element. The subclass element is responsible for
   * figuring out which content to load and correctly rendering it.
   * @return {boolean} True if content was successfully loaded, false
   *  if there was no more content to load.
   * @protected
   */
  protected abstract loadPreviousSection(): boolean;

  /**
   * @return {boolean} True if this element is currently
   * in the process of loading or processing new data. Basically, it
   * will check this before it kicks off a new loading cycle.
   * @protected
   */
  protected abstract isBusy(): boolean;

  /**
   * Gets the current height of the buffer content that we have loaded below
   * the user's current scroll position.
   * @return {number} The height of the buffer, in pixels.
   * @private
   */
  private currentBottomBufferUsed(): number {
    // The height of the displayed portion of the element.
    const viewportHeight = this.clientHeight;
    // The full height of the element.
    const contentHeight = this.scrollHeight;
    // How far the element is scrolled.
    const scrollDistance = this.scrollTop;

    // Find out how many we actually have loaded.
    return contentHeight - (scrollDistance + viewportHeight);
  }

  /**
   * Determines if enough content has been loaded above the current viewport.
   * @return {boolean} True if sufficient content has been loaded, false
   *  if we should load some more.
   * @private
   */
  private isEnoughLoadedAbove(): boolean {
    // How many pixels above the current viewport we have loaded.
    const topBufferHeight = this.scrollTop;
    // The height of the displayed portion of the element.
    const viewportHeight = this.clientHeight;

    // Compute how many pixels worth of content beyond the
    // user's current position we want to have loaded.
    const bufferSizePx = (viewportHeight * this.OVERFILL_MARGIN_PERCENT) / 100;
    return topBufferHeight >= bufferSizePx;
  }

  /**
   * Determines if enough content has been loaded below the current viewport.
   * @return {boolean} True if sufficient content has been loaded, false
   *  if we should load some more.
   * @private
   */
  private isEnoughLoadedBelow(): boolean {
    // The height of the displayed portion of the element.
    const viewportHeight = this.clientHeight;

    // Compute how many pixels worth of content beyond the
    // user's current position we want to have loaded.
    const bufferSizePx = (viewportHeight * this.OVERFILL_MARGIN_PERCENT) / 100;
    const bufferUsedPx = this.currentBottomBufferUsed();

    return bufferUsedPx >= bufferSizePx;
  }

  /**
   * Determines if too much content has been loaded above the viewport. If so,
   * there is a substantial amount of content that is not visible to the
   * user, and we can scale it back in order to save memory.
   * @return {boolean} True if too much content has been loaded, false
   * otherwise.
   * @private
   */
  private isTooMuchLoadedAbove(): boolean {
    // How many pixels above the current viewport we have loaded.
    const topBufferHeight = this.scrollTop;
    // The height of the displayed portion of the element.
    const viewportHeight = this.clientHeight;

    return (
      topBufferHeight > (viewportHeight * this.MAXIMUM_OVERFILL_PERCENT) / 100
    );
  }

  /**
   * Determines if too much content has been loaded below the viewport. If so,
   * there is a substantial amount of content that is not visible to the
   * user, and we can scale it back in order to save memory.
   * @return {boolean} True if too much content has been loaded, false
   * otherwise.
   * @private
   */
  private isTooMuchLoadedBelow(): boolean {
    // How many pixels below the current viewport we have loaded.
    const bottomBufferHeight = this.currentBottomBufferUsed();
    // The height of the displayed portion of the element.
    const viewportHeight = this.clientHeight;

    return (
      bottomBufferHeight >
      (viewportHeight * this.MAXIMUM_OVERFILL_PERCENT) / 100
    );
  }

  /**
   * Loads additional content until we have enough.
   * @private
   */
  private loadContentWhileNeeded(): void {
    while (
      !this.isBusy() &&
      !this.isEnoughLoadedAbove() &&
      this.loadPreviousSection()
    ) {}
    while (
      !this.isBusy() &&
      !this.isEnoughLoadedBelow() &&
      this.loadNextSection()
    ) {}
  }

  /**
   * @inheritDoc
   */
  protected firstUpdated(_: PropertyValues) {
    // Add a handler for scroll events which loads more
    // content if needed.
    this.addEventListener("scroll", (_) => this.loadContentWhileNeeded());
  }

  /**
   * @inheritDoc
   */
  protected updated(_: PropertyValues) {
    // If something changed, that might indicate that we have more data to
    // load.
    this.loadContentWhileNeeded();
  }
}
