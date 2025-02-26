import { LitElement } from "lit";
import { Action } from "redux";
import { MallardStore } from "./store";
import { connect } from "pwa-helpers";

export type EventMapType = {
  [p: string]: (event: Event) => Action | Promise<Action>;
};
type EventHandler = (e: Event) => void;
type Constructor<T> = new (...args: any[]) => T;

/**
 * Creates a version of a class that is connected to the Redux store. This
 * differs from the vanilla `pwa-helpers` `connect()` function in that it
 * also adds some functionality for automatically mapping events to actions.
 * @param {MallardStore} store The store to connect to.
 * @param {Constructor<LitElement>} superclass The element class to modify.
 * @return {unknown} A new version of the element with the Redux
 * connection.
 */
export function connectRedux<ElementType extends Constructor<LitElement>>(
  store: MallardStore,
  superclass: ElementType
) {
  /**
   * Base class that provides some syntactic sugar for connecting
   * custom elements to Redux.
   */
  abstract class ConnectedElement extends connect(store)(superclass) {
    /**
     * Stores the event listeners we have created, indexed by event
     * name.
     * @private
     */
    private eventListeners = new Map<string, EventHandler>();

    /**
     * @inheritDoc
     */
    override connectedCallback() {
      super.connectedCallback();

      const eventMap = this.mapEvents();
      // Set up the event handlers.
      // eslint-disable-next-line guard-for-in
      for (const key in eventMap) {
        const eventHandler = (event: Event) => {
          // Typing hack is due to it being able to accept the result of
          // an AsyncThunk, even though the type of dispatch() doesn't
          // reflect that.
          store.dispatch(eventMap[key](event) as unknown as Action);
        };
        this.addEventListener(key, eventHandler);
        this.eventListeners.set(key, eventHandler);
      }
    }

    /**
     * @inheritDoc
     */
    override disconnectedCallback() {
      super.disconnectedCallback();

      for (const key of this.eventListeners.keys()) {
        this.removeEventListener(
          key,
          this.eventListeners.get(key) as EventHandler
        );
        this.eventListeners.delete(key);
      }
    }

    /**
     * Maps events to actions. This function should be overridden by subclasses
     * to define the mapping between events and actions. The action will
     * automatically be dispatched when the event is fired.
     * @return {EventMapType} The mapping between events and
     * actions.
     */
    abstract mapEvents(): EventMapType;
  }

  return ConnectedElement;
}
