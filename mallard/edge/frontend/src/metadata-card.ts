import { css, html, LitElement, PropertyValues } from "lit";
import { property, state } from "lit/decorators.js";
import { UavImageMetadata } from "mallard-api";
import "@material/mwc-list";
import "@material/mwc-list/mwc-list-item.js";
import "@material/mwc-icon";
import "@material/mwc-circular-progress";
import { connect } from "@captaincodeman/redux-connect-element";
import store from "./store";
import {
  thumbnailGridSelectors,
  thunkLoadMetadata,
} from "./thumbnail-grid-slice";
import { ImageStatus } from "./types";
import { Action } from "redux";

/**
 * Card that shows basic metadata for an image.
 */
export class MetadataCard extends LitElement {
  static readonly tagName: string = "metadata-card";

  static styles = css`
    .card {
      margin: 20px;
    }

    .card-content {
      margin-left: 20px;
      margin-right: 20px;
      min-height: 30vh;
    }

    .card-title-element {
      margin-top: 20px;
      margin-bottom: 20px;
    }

    h2 {
      font-family: Roboto;
      font-weight: 500;
    }
  `;

  /**
   * Name for the custom event signaling that the displayed metadata has
   * changed.
   */
  static readonly METADATA_CHANGED_EVENT_NAME = `${MetadataCard.tagName}-image-changed`;

  /**
   * The ID of the image that we are displaying metadata for.
   */
  @property({ type: String })
  frontendId?: string;

  /**
   * Metadata structure to display information from.
   */
  @state()
  metadata?: UavImageMetadata;

  /**
   * @inheritDoc
   */
  protected override render() {
    return html`
      <link rel="stylesheet" href="/static/mallard-edge.css" />

      <div class="mdc-card card">
        <div class="card-content">
          ${
            this.metadata === undefined
              ? html` <!-- Show the loading indicator -->
                  <mwc-circular-progress
                    class="vertical-center"
                    indeterminate
                  ></mwc-circular-progress>`
              : html` <h2 class="card-title-element">${this.metadata.name}</h2>
                  <mwc-list>
                    <mwc-list-item twoline graphic="avatar" noninteractive="">
                      <span>${this.metadata.sessionName ?? ""}</span>
                      <span slot="secondary">Session</span>
                      <mwc-icon slot="graphic">collections</mwc-icon>
                    </mwc-list-item>
                    <mwc-list-item twoline graphic="avatar" noninteractive="">
                      <span>${this.metadata.captureDate ?? ""}</span>
                      <span slot="secondary">Capture Date</span>
                      <mwc-icon slot="graphic">event</mwc-icon>
                    </mwc-list-item>
                    <mwc-list-item twoline graphic="avatar" noninteractive="">
                      <span>${this.metadata.camera ?? ""}</span>
                      <span slot="secondary">Camera</span>
                      <mwc-icon slot="graphic">camera_alt</mwc-icon>
                    </mwc-list-item>
                    <mwc-list-item twoline graphic="avatar" noninteractive="">
                      <span>${this.metadata.altitudeMeters ?? 0} meters</span>
                      <span slot="secondary">Flight Altitude</span>
                      <mwc-icon slot="graphic">height</mwc-icon>
                    </mwc-list-item>
                    <mwc-list-item twoline graphic="avatar" noninteractive="">
                      <span>${this.metadata.gsdCmPx ?? 0} px/cm</span>
                      <span slot="secondary">Ground Sample Distance</span>
                      <mwc-icon slot="graphic">satellite</mwc-icon>
                    </mwc-list-item>
                  </mwc-list>`
          }
        </div>
      </div>
        </div>
      </div>
    `;
  }

  /**
   * @inheritDoc
   */
  protected override updated(_changedProperties: PropertyValues) {
    super.updated(_changedProperties);

    if (_changedProperties.has("frontendId")) {
      // The image ID has changed. We need to fire an event for this to kick
      // off the actual metadata loading.
      this.dispatchEvent(
        new CustomEvent<string>(MetadataCard.METADATA_CHANGED_EVENT_NAME, {
          bubbles: true,
          composed: false,
          detail: this.frontendId,
        })
      );
    }
  }
}

/**
 * Extension of `MetadataCard` that connects to Redux.
 */
export class ConnectedMetadataCard extends connect(store, MetadataCard) {
  /**
   * @inheritDoc
   */
  mapState(state: any): { [p: string]: any } {
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
   * @inheritDoc
   */
  mapEvents(): { [p: string]: (event: Event) => Action } {
    const handlers: { [p: string]: (event: Event) => Action } = {};

    // The fancy casting here is a hack to deal with the fact that
    // thunkLoadMetadata produces an AsyncThunkAction but mapEvents is typed
    // as requiring an Action.
    // However, it still works just fine with an AsyncThunkAction.
    handlers[ConnectedMetadataCard.METADATA_CHANGED_EVENT_NAME] = (
      event: Event
    ) =>
      thunkLoadMetadata([
        (event as CustomEvent<string>).detail,
      ]) as unknown as Action;
    return handlers;
  }
}
