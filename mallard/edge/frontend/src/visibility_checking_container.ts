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
   * @param {Element} _child The element that became visible.
   * @protected
   */
  protected onChildVisible(_child: Element) {}

  /**
   * Called whenever a child element becomes invisible.
   * @param {Element} _child The element that became invisible.
   * @protected
   */
  protected onChildNotVisible(_child: Element) {}

  /**
   * Checks if a particular element is visible (or close enough) in the
   * viewport.
   * @param {Element} element The element to check.
   * @return {boolean} True if it is visible.
   * @private
   */
  private isVisible(element: Element): boolean {
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
    let lastElement = this.visibleChildren.peekBack();
    while (lastElement && !this.isVisible(lastElement)) {
      // Element is not visible and should be removed from the visible set.
      this.onChildNotVisible(lastElement);
      this.visibleChildren.pop();
      lastElement = this.visibleChildren.peekBack();
    }

    let firstElement = this.visibleChildren.peekFront();
    while (firstElement && !this.isVisible(firstElement)) {
      this.onChildNotVisible(firstElement);
      this.visibleChildren.shift();
      firstElement = this.visibleChildren.peekFront();
    }
  }

  /**
   * Updates the set of visible children to add any that are newly visible.
   * @private
   */
  private addAllNewlyVisible() {
    // See if there are any children afterwards that are visible.
    let lastElement = this.visibleChildren.peekBack()?.nextElementSibling;
    while (lastElement && this.isVisible(lastElement)) {
      // Mark it as visible.
      this.onChildVisible(lastElement);
      this.visibleChildren.push(lastElement);
      // Check the next one.
      lastElement = lastElement.nextElementSibling;
    }

    // See if there are any children before that are visible.
    let firstElement = this.visibleChildren.peekFront()?.previousElementSibling;
    while (firstElement && this.isVisible(firstElement)) {
      this.onChildVisible(firstElement);
      this.visibleChildren.unshift(firstElement);
      firstElement = firstElement.previousElementSibling;
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
        break;
      }
    }

    // We can now update with any nearby children that are also visible.
    this.addAllNewlyVisible();
  }

  /**
   * @inheritDoc
   */
  protected override firstUpdated(_: PropertyValues) {
    const update = () => {
      this.removeAllInvisible();
      this.addAllNewlyVisible();
    };

    // Add a handler for scroll events which loads more
    // content if needed.
    this.addEventListener("scroll", update);
  }
}
