import { css, html, nothing } from "lit";
import { property } from "lit/decorators.js";
import { PlatformType, UavImageMetadata } from "mallard-api";
import "@material/mwc-list";
import "@material/mwc-list/mwc-list-item.js";
import "@material/mwc-icon";
import "@material/web/all";
import store, { RootState } from "./store";
import { Action } from "redux";
import { ArtifactInfoBase } from "./artifact-info-base";
import { connectRedux } from "./connected-element";

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
            !this.metadata
              ? html` <!-- Show the loading indicator -->
                  <md-circular-progress
                    class="vertical-center"
                    indeterminate
                  ></md-circular-progress>`
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
export class ConnectedMetadataCard extends connectRedux(store, MetadataCard) {
  /**
   * @inheritDoc
   */
  override stateChanged(state: any): void {
    this.metadataUpdatesFromState(state as RootState);
  }

  /**
   * @inheritDoc
   */
  override mapEvents(): { [p: string]: (event: Event) => Action } {
    return this.metadataLoadEventHandlers();
  }
}
