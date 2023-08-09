import { css, html, LitElement, PropertyValues } from "lit";
import { property, state } from "lit/decorators.js";
import "@material/mwc-icon/mwc-icon.js";
import "@material/mwc-list";
import "./large-artifact-display";
import "./metadata-card";
import "./notes-card";
import { connect } from "@captaincodeman/redux-connect-element";
import store from "./store";
import { Action } from "redux";
import { ObjectRef, ObjectType } from "mallard-api";
import { thunkShowDetails } from "./thumbnail-grid-slice";

/**
 * This is the main element for the details page.
 */
export class ArtifactDetails extends LitElement {
  static readonly tagName: string = "artifact-details";

  static styles = css`
    /* Animation for flying in from the right. */
    @keyframes fly-in-right {
      from {
        left: 100%;
      }
      to {
        left: 0;
      }
    }

    .grid-layout {
      display: grid;
    }

    /* The main image panel. */
    .main-panel {
      grid-column-start: 1;
      grid-column-end: 3;
    }

    /* The side panel. */
    .side-panel {
      grid-column-start: 3;
      grid-column-end: 4;
      width: 25vw;
      overflow: auto;
      /* Extra 64px leaves room for the navigation bar. */
      height: calc(100vh - 64px);

      /** Start all the way off to the side. */
      position: relative;
      left: 100%;
      animation-name: fly-in-right;
      animation-duration: 0.25s;
      animation-delay: 0.5s;
      animation-fill-mode: forwards;
    }
  `;

  /**
   * Name for the custom event signaling that the displayed image has changed.
   */
  static readonly IMAGE_CHANGED_EVENT_NAME = `${ArtifactDetails.tagName}-image-changed`;

  /**
   * The bucket that this image is in on the backend.
   */
  @property({ type: String })
  backendBucket?: string;

  /**
   * The UUID of this image on the backend.
   */
  @property({ type: String })
  backendName?: string;

  /**
   * The type of this artifact.
   */
  @property({ type: String })
  artifactType?: ObjectType;

  /**
   * The frontend ID of the image we are displaying details for.
   * @protected
   */
  @state()
  protected frontendId?: string = undefined;

  /**
   * @inheritDoc
   */
  protected override render() {
    if (!this.backendBucket || !this.backendName) {
      // Don't render anything.
      return html``;
    }

    return html`
      <div class="grid-layout">
        <div class="main-panel">
          <large-artifact-display
            .frontendId=${this.frontendId}
            .type=${this.artifactType}
          ></large-artifact-display>
        </div>
        <div class="side-panel">
          <metadata-card .frontendId=${this.frontendId}></metadata-card>
          <notes-card .frontendId=${this.frontendId}></notes-card>
        </div>
      </div>
    `;
  }

  /**
   * @inheritDoc
   */
  protected override willUpdate(_changedProperties: PropertyValues) {
    super.willUpdate(_changedProperties);

    if (
      (_changedProperties.has("backendBucket") ||
        _changedProperties.has("backendName")) &&
      this.backendBucket !== undefined &&
      this.backendName !== undefined
    ) {
      // Set the frontendId to undefined. We don't want any child
      // components to update with the old data while the event is being
      // handled.
      this.frontendId = undefined;
      // The image was changed. Dispatch the event.
      this.dispatchEvent(
        new CustomEvent<ObjectRef>(ArtifactDetails.IMAGE_CHANGED_EVENT_NAME, {
          bubbles: true,
          composed: false,
          detail: { bucket: this.backendBucket, name: this.backendName },
        })
      );
    }
  }
}

/**
 * Extension of `ArtifactDetails` that connects to Redux.
 */
export class ConnectedArtifactDetails extends connect(store, ArtifactDetails) {
  /**
   * @inheritDoc
   */
  mapState(state: any): { [p: string]: any } {
    return { frontendId: state.imageView.details.frontendId ?? undefined };
  }

  /**
   * @inheritDoc
   */
  mapEvents(): { [p: string]: (event: Event) => Action } {
    const handlers: { [p: string]: (event: Event) => Action } = {};

    // The fancy casting here is a hack to deal with the fact that
    // thunkShowDetails produces an ThunkResult but mapEvents is typed
    // as requiring an Action.
    // However, it still works just fine with a ThunkResult.
    handlers[ConnectedArtifactDetails.IMAGE_CHANGED_EVENT_NAME] = (
      event: Event
    ) =>
      thunkShowDetails(
        (event as CustomEvent<ObjectRef>).detail
      ) as unknown as Action;
    return handlers;
  }
}
