import { LitElement, PropertyValues } from "lit";
import { property } from "lit/decorators.js";
import { ImageStatus, RootState } from "./types";
import {
  thumbnailGridSelectors,
  thunkLoadMetadata,
} from "./thumbnail-grid-slice";
import { Action } from "redux";

/**
 * Base class for elements that derive information from a single artifact.
 */
export class ArtifactInfoBase extends LitElement {
  /**
   * Name for the custom event signaling that the displayed image has changed.
   */
  static readonly ARTIFACT_CHANGED_EVENT_NAME = `artifact-info-artifact-changed`;

  /**
   * The ID of the image that we are displaying info for.
   */
  @property({ type: String })
  frontendId?: string;

  /**
   * @inheritDoc
   */
  protected override updated(_changedProperties: PropertyValues) {
    super.updated(_changedProperties);

    if (_changedProperties.has("frontendId")) {
      // The image ID has changed. We need to fire an event for this to kick
      // off the actual image loading.
      this.dispatchEvent(
        new CustomEvent<string>(ArtifactInfoBase.ARTIFACT_CHANGED_EVENT_NAME, {
          bubbles: true,
          composed: false,
          detail: this.frontendId,
        })
      );
    }
  }

  /**
   * Generates updates from the Redux state for the image metadata.
   * @param {RootState} state The state to update from.
   * @return {Object} The relevant updates.
   * @protected
   */
  protected metadataUpdatesFromState(state: RootState): { [p: string]: any } {
    if (!this.frontendId) {
      // We don't have any image specified, so we can't do anything.
      return {};
    }

    // Get the metadata for the image.
    const imageEntity = thumbnailGridSelectors.selectById(
      state,
      this.frontendId
    );
    if (!imageEntity || imageEntity.metadataStatus != ImageStatus.LOADED) {
      // Image loading has not been started yet.
      return {};
    }

    return { metadata: imageEntity.metadata };
  }

  /**
   * Generates the handlers for loading metadata when the artifact changes.
   * @return {Object} The handlers to use for each event.
   * @protected
   */
  protected metadataLoadEventHandlers(): {
    [p: string]: (event: Event) => Action;
  } {
    const handlers: { [p: string]: (event: Event) => Action } = {};

    // The fancy casting here is a hack to deal with the fact that
    // thunkLoadMetadata produces an AsyncThunkAction but mapEvents is typed
    // as requiring an Action.
    // However, it still works just fine with an AsyncThunkAction.
    handlers[ArtifactInfoBase.ARTIFACT_CHANGED_EVENT_NAME] = (event: Event) =>
      thunkLoadMetadata([
        (event as CustomEvent<string>).detail,
      ]) as unknown as Action;
    return handlers;
  }
}
