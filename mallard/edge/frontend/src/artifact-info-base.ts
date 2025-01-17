import { LitElement, PropertyValues } from "lit";
import { property, state } from "lit/decorators.js";
import { ArtifactStatus, RootState } from "./types";
import {
  thumbnailGridSelectors,
  thunkLoadMetadata,
} from "./thumbnail-grid-slice";
import { Action } from "redux";
import { ObjectType } from "mallard-api";

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
   * The type of object that we are displaying info for.
   */
  @property({ type: String })
  type?: ObjectType;

  /**
   * Whether we want to load this image right now.
   */
  @state()
  enableLoading: boolean = true;

  /**
   * @inheritDoc
   */
  protected override willUpdate(_changedProperties: PropertyValues) {
    super.willUpdate(_changedProperties);

    if (_changedProperties.has("frontendId") && this.enableLoading) {
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
    const entity = thumbnailGridSelectors.selectById(state, this.frontendId);
    if (
      !entity ||
      (entity.backendId.type === ObjectType.IMAGE &&
        entity.metadataStatus != ArtifactStatus.LOADED)
    ) {
      // Image loading has not been started yet.
      return {};
    }

    return { metadata: entity.metadata, type: entity.backendId.type };
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
