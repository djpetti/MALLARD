import { css, html, nothing } from "lit";
import { property } from "lit/decorators.js";
import { PlatformType, UavImageMetadata } from "mallard-api";
import "@material/web/all";
import store, { RootState } from "./store";
import { Action } from "redux";
import { ArtifactInfoBase } from "./artifact-info-base";
import { connectRedux } from "./connected-element";
import "mdui/components/card.js";

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

    md-list {
      --md-list-container-color: var(--md-sys-color-surface-bright);
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

      <mdui-card class="card" variant="elevated">
        <div class="card-content">
          ${
            !this.metadata
              ? html` <!-- Show the loading indicator -->
                  <md-circular-progress
                    class="vertical-center"
                    indeterminate
                  ></md-circular-progress>`
              : html` <h2 class="card-title-element">${this.metadata.name}</h2>
                  <md-list>
                    <md-list-item>
                      <span slot="headline"
                        >${this.metadata.sessionName ?? ""}</span
                      >
                      <span slot="supporting-text">Session</span>
                      <md-icon slot="start">collections</md-icon>
                    </md-list-item>
                    <md-list-item>
                      <span slot="headline"
                        >${this.metadata.captureDate ?? ""}</span
                      >
                      <span slot="supporting-text">Capture Date</span>
                      <md-icon slot="start">event</md-icon>
                    </md-list-item>
                    <md-list-item>
                      <span slot="headline">${this.metadata.camera ?? ""}</span>
                      <span slot="supporting-text">Camera</span>
                      <md-icon slot="start">camera_alt</md-icon>
                    </md-list-item>
                    ${this.metadata.platformType == PlatformType.AERIAL
                      ? html`<md-list-item>
                      <span slot="headline">${
                        this.metadata.altitudeMeters ?? 0
                      } meters</span>
                      <span slot="supporting-text">Flight Altitude</span>
                      <md-icon slot="start">height</md-icon>
                    </md-list-item>
                    <md-list-item>
                      <span slot="headline">${
                        this.metadata.gsdCmPx ?? 0
                      } px/cm</span>
                      <span slot="supporting-text">Ground Sample Distance</span>
                      <md-icon slot="start">satellite</md-icon>
                    </md-list-item>
                  </md-list>`
                      : nothing}</md-list
                  >`
          }
        </div>
      </mdui-card>
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
