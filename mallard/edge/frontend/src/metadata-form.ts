import { css, html, LitElement, property, TemplateResult } from "lit-element";
import { ImageMetadata, PlatformType } from "./types";
import "@material/mwc-circular-progress";
import "@material/mwc-formfield";
import "@material/mwc-radio";
import "@material/mwc-textarea";
import "@material/mwc-textfield";

/** Keeps track of what state the form is in. */
enum FormState {
  INACTIVE,
  LOADING,
  READY,
}

const TEST_METADATA: ImageMetadata = { platformType: PlatformType.AERIAL };

/**
 * A form that allows the user to manually specify metadata.
 */
export class MetadataForm extends LitElement {
  static tagName: string = "metadata-form";
  static styles = css`
    .hidden {
      display: none;
    }

    #main {
      min-width: 500px;
    }

    #loading_indicator {
      --mdc-theme-primary: var(--theme-gray);
    }

    #form {
      padding: 10%;
    }

    #platform_fields {
      margin-top: 1.5em;
    }
  `;

  /** Metadata that this element is displaying. If set to null,
   * no metadata has been provided yet.
   */
  @property({ attribute: false })
  metadata: ImageMetadata | null = TEST_METADATA;

  /** Whether the user has modified the metadata in any way. */
  @property({ attribute: false })
  userModified: boolean = false;

  /** Current state of this element. */
  private state: FormState = FormState.READY;

  /**
   * Safely extracts the capture date from the local metadata, in a format
   * that can be used in a date input. If the date is not supplied, it returns
   * the current date.
   * @return {string} The extracted date, in ISO format (but local time).
   * @private
   */
  private extractCaptureDate(): string {
    // If we don't have a date, use the current one.
    const date = new Date(this.metadata?.captureDate ?? Date());

    // Convert to ISO format.
    const paddedMonth = (date.getMonth() + 1).toString().padStart(2, "0");
    const paddedDate = date.getDate().toString().padStart(2, "0");
    return `${date.getFullYear()}-${paddedMonth}-${paddedDate}`;
  }

  /**
   * @inheritDoc
   */
  protected render() {
    // Visibility of the entire element.
    const elementVisibility = this.state == FormState.INACTIVE ? "hidden" : "";
    // Visibility of the loading indicator.
    const loadingVisibility = this.state == FormState.LOADING ? "" : "hidden";
    // Visibility of the main form.
    const formVisibility = this.state == FormState.READY ? "" : "hidden";

    // Selects the correct radio button for the platform type.
    const platformTypeUnSelected = html` <mwc-radio
      name="platform_type"
    ></mwc-radio>`;
    const platformTypeSelected = html` <mwc-radio
      name="platform_type"
      checked
    ></mwc-radio>`;

    const makePlatformTypeRadio = (type: PlatformType): TemplateResult => {
      return this.metadata?.platformType == type
        ? platformTypeSelected
        : platformTypeUnSelected;
    };

    // Portion of the form that's specific to the platform type.
    const groundSpecificFields = html``;
    const airSpecificFields = html`
      <div class="row">
        <div class="column_width2">
          <mwc-textfield
            label="Altitude"
            type="number"
            step="0.1"
            min="0"
            helper="Flight altitude"
            value="${this.metadata?.altitudeMeters ?? ""}"
          ></mwc-textfield>
        </div>
        <div class="column_width1"><p>mAGL</p></div>
      </div>
      <div class="row">
        <div class="column_width2">
          <mwc-textfield
            label="GSD"
            type="number"
            step="0.1"
            min="0"
            helper="Ground Sample Distance"
            value="${this.metadata?.gsdCmPx ?? ""}"
          ></mwc-textfield>
        </div>
        <div class="column_width1"><p>cm/px</p></div>
      </div>
    `;

    return html`
      <link rel="stylesheet" href="./static/mallard-edge.css" />
      <div id="main" class="${elementVisibility}">
        <mwc-circular-progress
          id="loading_indicator"
          indeterminate
          density="14"
          class="${loadingVisibility} center"
        ></mwc-circular-progress>

        <div id="form" class="${formVisibility}">
          <div class="row">
            <div class="column_width1">
              <mwc-textfield label="Session Name" value=""></mwc-textfield>
            </div>
          </div>
          <div class="row">
            <div class="column_width1">
              <mwc-textfield
                label="Capture Date"
                value="${this.extractCaptureDate()}"
                type="date"
              ></mwc-textfield>
            </div>
            <div class="column_width1">
              <mwc-textfield
                label="Camera"
                value="${this.metadata?.camera ?? ""}"
              ></mwc-textfield>
            </div>
          </div>

          <div class="row">
            <div class="column_width1">
              <p>Imaging platform type:</p>
              <mwc-formfield label="Ground">
                ${makePlatformTypeRadio(PlatformType.GROUND)}
              </mwc-formfield>
              <mwc-formfield label="Aerial">
                ${makePlatformTypeRadio(PlatformType.AERIAL)}
              </mwc-formfield>
            </div>
            <div class="column_width1">
              <!-- This column is metadata that's specific to the platform type. -->
              <div id="platform_fields">
                ${this.metadata?.platformType == PlatformType.AERIAL
                  ? airSpecificFields
                  : groundSpecificFields}
              </div>
            </div>
          </div>

          <div class="row">
            <div class="column_width1">
              <mwc-textarea
                label="Notes"
                cols="3"
                value="${this.metadata?.notes ?? ""}"
              >
              </mwc-textarea>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}
