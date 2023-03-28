import { css, html, nothing } from "lit";
import { property } from "lit/decorators.js";
import { PlatformType, UavImageMetadata } from "mallard-api";
import "@material/mwc-list";
import "@material/mwc-list/mwc-list-item.js";
import "@material/mwc-icon";
import "@material/mwc-circular-progress";
import { connect } from "@captaincodeman/redux-connect-element";
import store from "./store";
import { RootState } from "./types";
import { Action } from "redux";
import { ArtifactInfoBase } from "./artifact-info-base";

/**
 * Card that shows basic metadata for an image.
 */
export class MetadataCard extends ArtifactInfoBase {
  static readonly tagName: string = "metadata-card";

  static styles = css`
    .card {
      margin: 20px;
    }

    .card-content {
      margin-left: 20px;
      margin-right: 20px;
      min-height: 20vh;
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
   * Metadata structure to display information from.
   */
  @property({ type: Object, attribute: false })
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
                    ${this.metadata.platformType == PlatformType.AERIAL
                      ? html`<mwc-list-item twoline graphic="avatar" noninteractive="">
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
                      : nothing}</mwc-list
                  >`
          }
        </div>
      </div>
        </div>
      </div>
    `;
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
    return this.metadataUpdatesFromState(state as RootState);
  }

  /**
   * @inheritDoc
   */
  mapEvents(): { [p: string]: (event: Event) => Action } {
    return this.metadataLoadEventHandlers();
  }
}
