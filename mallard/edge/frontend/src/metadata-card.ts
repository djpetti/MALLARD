import { css, html, LitElement } from "lit";

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
   * @inheritDoc
   */
  protected override render() {
    return html`
      <link rel="stylesheet" href="/static/mallard-edge.css" />
      <div class="mdc-card card">
        <div class="card-content">
          <h2 class="card-title-element">Image Name</h2>
          <mwc-list>
            <mwc-list-item twoline graphic="avatar" noninteractive="">
              <span>My Session</span>
              <span slot="secondary">Session</span>
              <mwc-icon slot="graphic">collections</mwc-icon>
            </mwc-list-item>
            <mwc-list-item twoline graphic="avatar" noninteractive="">
              <span>2023-03-21</span>
              <span slot="secondary">Capture Date</span>
              <mwc-icon slot="graphic">event</mwc-icon>
            </mwc-list-item>
            <mwc-list-item twoline graphic="avatar" noninteractive="">
              <span>Panasonic DMC-6</span>
              <span slot="secondary">Camera</span>
              <mwc-icon slot="graphic">camera_alt</mwc-icon>
            </mwc-list-item>
            <mwc-list-item twoline graphic="avatar" noninteractive="">
              <span>15 meters</span>
              <span slot="secondary">Flight Altitude</span>
              <mwc-icon slot="graphic">height</mwc-icon>
            </mwc-list-item>
            <mwc-list-item twoline graphic="avatar" noninteractive="">
              <span>0.23 px/cm</span>
              <span slot="secondary">Ground Sample Distance</span>
              <mwc-icon slot="graphic">satellite</mwc-icon>
            </mwc-list-item>
          </mwc-list>
        </div>
      </div>
    `;
  }
}
