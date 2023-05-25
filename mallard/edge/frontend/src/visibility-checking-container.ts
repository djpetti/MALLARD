import { LitElement, PropertyValues } from "lit";
import Denque from "denque";

/**
 * Element that is capable of monitoring the visibility status of its own
 * child elements.
 */
export abstract class VisibilityCheckingContainer extends LitElement {
  /**
   * We keep some additional content loaded even if it's technically
   * offscreen, so we can respond quickly if the user scrolls. This sets the
   * percentage of the viewport that we want to use for the buffer size.
   * @private
   */
  private static readonly VISIBLE_MARGIN_PERCENT = 50;

  /** Keeps track of the child elements that are currently visible. */
  private visibleChildren: Denque<Element> = new Denque<Element>();

  /** Observer to use for reacting to size changes. */
  private parentResizeObserver?: ResizeObserver;

  /** Whether visibility tracking is currently enabled. */
  private trackingEnabled: boolean = false;

  /** Abort signal to use for removing the scroll event listener. */
  private scrollEventRemovalController?: AbortController;

  /**
   * Gets the parent element. We will be managing the children of this
   * element. New children can be dynamically added at the beginning and end,
   * however, it assumes that children won't be added in the middle, nor will
   * they be removed.
   * @return {HTMLElement} The parent element.
   * @protected
   */
  protected abstract getParentElement(): HTMLElement;

  /**
   * Called whenever a child element becomes visible.
   * @param {Element[]} _children The elements that became visible.
   * @protected
   */
  protected onChildrenVisible(_children: Element[]) {}

  /**
   * Called whenever a child element becomes invisible.
   * @param {Element[]} _children The elements that became invisible.
   * @protected
   */
  protected onChildrenNotVisible(_children: Element[]) {}

  /**
   * Checks if a particular element is visible (or close enough) in the
   * viewport.
   * @param {Element} element The element to check.
   * @return {boolean} True if it is visible.
   * @private
   */
  private isVisible(element: Element): boolean {
    if (!element.isConnected) {
      // If it's not connected, we're not going to get an accurate read of
      // the bounding box.
      return false;
    }

    const bufferSizePx =
      (window.innerHeight *
        VisibilityCheckingContainer.VISIBLE_MARGIN_PERCENT) /
      100;

    const boundingRect = element.getBoundingClientRect();
    return (
      boundingRect.bottom >= -bufferSizePx &&
      boundingRect.top <= window.innerHeight + bufferSizePx
    );
  }

  /**
   * Updates the set of visible children to remove any that are no longer
   * visible.
   * @private
   */
  private removeAllInvisible() {
    const invisibleChildren: Element[] = [];

    let lastElement = this.visibleChildren.peekBack();
    while (lastElement && !this.isVisible(lastElement)) {
      // Element is not visible and should be removed from the visible set.
      invisibleChildren.push(lastElement);
      this.visibleChildren.pop();
      lastElement = this.visibleChildren.peekBack();
    }

    let firstElement = this.visibleChildren.peekFront();
    while (firstElement && !this.isVisible(firstElement)) {
      invisibleChildren.push(firstElement);
      this.visibleChildren.shift();
      firstElement = this.visibleChildren.peekFront();
    }

    // Run the callback.
    if (invisibleChildren.length > 0) {
      this.onChildrenNotVisible(invisibleChildren);
    }
  }

  /**
   * Updates the set of visible children to add any that are newly visible.
   * @private
   */
  private addAllNewlyVisible() {
    const visibleChildren: Element[] = [];

    // See if there are any children afterwards that are visible.
    let lastElement = this.visibleChildren.peekBack()?.nextElementSibling;
    while (lastElement && this.isVisible(lastElement)) {
      // Mark it as visible.
      visibleChildren.push(lastElement);
      this.visibleChildren.push(lastElement);
      // Check the next one.
      lastElement = lastElement.nextElementSibling;
    }

    // See if there are any children before that are visible.
    let firstElement = this.visibleChildren.peekFront()?.previousElementSibling;
    while (firstElement && this.isVisible(firstElement)) {
      visibleChildren.push(firstElement);
      this.visibleChildren.unshift(firstElement);
      firstElement = firstElement.previousElementSibling;
    }

    if (visibleChildren.length > 0) {
      this.onChildrenVisible(visibleChildren);
    }
  }

  /**
   * Resets the visibility tracking logic, and reinitializes by manually
   * checking the visibility status of every child element. This should be
   * used whenever the collection of children changes in a way that is not
   * supported by visibility tracking, such as items being removed or added
   * in the middle.
   * @protected
   */
  protected resetVisibilityTracking() {
    this.visibleChildren.clear();

    // Find at least one child that is visible.
    const children = this.getParentElement().children;
    for (const child of children) {
      if (this.isVisible(child)) {
        this.visibleChildren.push(child);
        this.onChildrenVisible([child]);
        break;
      }
    }

    // We can now update with any nearby children that are also visible.
    this.addAllNewlyVisible();
  }

  /**
   * Re-enabled visibility tracking after it has been disabled.
   * @protected
   */
  public enableVisibilityTracking() {
    if (this.trackingEnabled) {
      // Already enabled. Don't add the listeners twice.
      return;
    }

    this.resetVisibilityTracking();

    const update = () => {
      if (this.visibleChildren.isEmpty()) {
        this.resetVisibilityTracking();
      } else {
        this.removeAllInvisible();
        this.addAllNewlyVisible();
      }
    };

    // Add a handler for scroll events which loads more
    // content if needed.
    this.scrollEventRemovalController = new AbortController();
    this.addEventListener("scroll", update, {
      signal: this.scrollEventRemovalController.signal,
    });

    // Add a resize observer so that we can update the visibility whenever
    // the size changes.
    this.parentResizeObserver = new ResizeObserver(update);
    this.parentResizeObserver.observe(this.getParentElement());

    this.trackingEnabled = true;
  }

  /**
   * Disables visibility tracking temporarily. After this is called, it will
   * no longer track the visibility of child elements.
   * @protected
   */
  public disableVisibilityTracking() {
    if (!this.trackingEnabled) {
      return;
    }

    this.scrollEventRemovalController?.abort();
    this.parentResizeObserver?.unobserve(this.getParentElement());

    this.trackingEnabled = false;
  }

  /**
   * @return {boolean} Whether tracking is enabled.
   */
  public get isTrackingEnabled(): boolean {
    return this.trackingEnabled;
  }

  /**
   * @inheritDoc
   */
  protected override firstUpdated(_: PropertyValues) {
    this.enableVisibilityTracking();
  }
}
