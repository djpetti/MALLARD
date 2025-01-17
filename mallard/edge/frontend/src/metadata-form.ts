import { css, html, LitElement, PropertyValues, TemplateResult } from "lit";
import { property } from "lit/decorators.js";
import {
  EditableMetadata,
  filterOnlyEditable,
  MetadataInferenceStatus,
  RootState,
} from "./types";
import "@material/mwc-circular-progress";
import "@material/mwc-formfield";
import "@material/mwc-radio";
import "@material/mwc-textarea";
import "@material/mwc-textfield";
import { connect } from "@captaincodeman/redux-connect-element";
import store from "./store";
import { PlatformType } from "mallard-api";
import { Action } from "redux";
import { setMetadata } from "./upload-slice";
import { thumbnailGridSelectors } from "./thumbnail-grid-slice";

/** Keeps track of what state the form is in. */
export enum FormState {
  INACTIVE,
  LOADING,
  READY,
}

/**
 * A form that allows the user to manually specify metadata.
 * @customElement metadata-form
 */
export class MetadataForm extends LitElement {
  static readonly tagName: string = "metadata-form";
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

  /** Name for the custom event signalling that the user has modified the form. */
  static FORM_CHANGED_EVENT_NAME = "form-changed";

  /** Metadata that this element is displaying. If set to null,
   * no metadata has been provided yet.
   */
  @property({ attribute: false })
  metadata: EditableMetadata | null = null;

  /** Current state of this element. */
  @property({ attribute: false })
  state: FormState = FormState.INACTIVE;

  /** Whether the user has modified the metadata in any way. */
  protected userModified: boolean = false;

  /**
   * Safely extracts the capture date from the local metadata, in a format
   * that can be used in a date input. If the date is not supplied, it returns
   * the current date.
   * @return {string} The extracted date, in ISO format.
   * @private
   */
  private extractCaptureDate(): string {
    // If we don't have a date, use the current one.
    const date = new Date(this.metadata?.captureDate ?? Date());
    const dateString = date.toISOString().split("T")[0];

    if (this.metadata && !this.metadata.captureDate) {
      // Make sure the internal metadata reflects this.
      this.updateMetadata("captureDate", dateString);
    }

    return dateString;
  }

  /**
   * Updates the internal metadata.
   * @param {string} property The specific property to update within
   *  the metadata.
   * @param {any} value The value to set for the property.
   * @private
   */
  private updateMetadata(property: keyof EditableMetadata, value?: any): void {
    // Metadata should never be null if we're interacting with the form.
    const metadata = { ...(this.metadata as EditableMetadata) };

    // Either we set a pre-supplied value, or the value of the input element.
    metadata[property] = value;

    this.userModified = true;
    this.metadata = metadata;
  }

  /**
   * Updates the internal metadata based on an input `change` event.
   * @param {Event} event The event.
   * @param {string} property The specific property to update within
   *  the metadata.
   * @param {any} value The value to set for the property. If this is not provided,
   *  the value will be read from the event target's `value` property.
   * @private
   */
  private updateMetadataFromEvent(
    event: Event,
    property: keyof EditableMetadata,
    value?: any
  ): void {
    const eventTarget = event.target as HTMLInputElement;
    // Either we set a pre-supplied value, or the value of the input element.
    this.updateMetadata(property, value ?? eventTarget.value);
  }

  /**
   * Updates the internal metadata based on a numerical input `change` event.
   * Operates the same way as the more general version of this function, except
   * that the value will be converted to a number.
   * @param {Event} event The event.
   * @param {string} property The specific property to update within
   *  the metadata.
   * @private
   */
  private updateMetadataNumber(
    event: Event,
    property: keyof EditableMetadata
  ): void {
    // Properly convert the value to a number.
    const eventTarget = event.target as HTMLInputElement;
    const numericalValue = +eventTarget.value;

    this.updateMetadataFromEvent(event, property, numericalValue);
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

    const makePlatformTypeRadio = (
      type: PlatformType,
      id: string
    ): TemplateResult => {
      return html`
        <mwc-radio
          name="platform_type"
          id="${id}"
          ?checked="${this.metadata?.platformType == type}"
          @change="${(event: Event) =>
            this.updateMetadataFromEvent(event, "platformType", type)}"
        >
        </mwc-radio>
      `;
    };

    // Portion of the form that's specific to the platform type.
    const groundSpecificFields = html``;
    const airSpecificFields = html`
      <div class="row">
        <div class="column_width2">
          <mwc-textfield
            label="Altitude"
            id="altitude"
            type="number"
            step="0.1"
            min="0"
            helper="Flight altitude"
            value="${this.metadata?.altitudeMeters ?? ""}"
            @change="${(event: Event) =>
              this.updateMetadataNumber(event, "altitudeMeters")}"
          ></mwc-textfield>
        </div>
        <div class="column_width1"><p>mAGL</p></div>
      </div>
      <div class="row">
        <div class="column_width2">
          <mwc-textfield
            label="GSD"
            id="gsd"
            type="number"
            step="0.1"
            min="0"
            helper="Ground Sample Distance"
            value="${this.metadata?.gsdCmPx ?? ""}"
            @change="${(event: Event) =>
              this.updateMetadataNumber(event, "gsdCmPx")}"
          ></mwc-textfield>
        </div>
        <div class="column_width1"><p>cm/px</p></div>
      </div>
    `;

    return html`
      <link rel="stylesheet" href="/static/mallard-edge.css" />
      <div id="main" class="${elementVisibility}">
        <!-- Loading indicator. -->
        <mwc-circular-progress
          id="loading_indicator"
          indeterminate
          density="14"
          class="${loadingVisibility} center"
        ></mwc-circular-progress>

        <!-- Main form. -->
        <div id="form" class="${formVisibility}">
          <div class="row">
            <div class="column_width1">
              <mwc-textfield
                label="Session Name"
                id="session_name"
                value="${this.metadata?.sessionName ?? ""}"
                @change="${(event: Event) =>
                  this.updateMetadataFromEvent(event, "sessionName")}"
              ></mwc-textfield>
            </div>
          </div>
          <div class="row">
            <div class="column_width1">
              <mwc-textfield
                label="Capture Date"
                id="capture_date"
                value="${this.extractCaptureDate()}"
                type="date"
                @change="${(event: Event) =>
                  this.updateMetadataFromEvent(event, "captureDate")}"
              ></mwc-textfield>
            </div>
            <div class="column_width1">
              <mwc-textfield
                label="Camera"
                id="camera"
                value="${this.metadata?.camera ?? ""}"
                @change="${(event: Event) =>
                  this.updateMetadataFromEvent(event, "camera")}"
              ></mwc-textfield>
            </div>
          </div>

          <div class="row">
            <!-- Platform type selection. -->
            <div class="column_width1">
              <p>Imaging platform type:</p>
              <mwc-formfield label="Ground">
                ${makePlatformTypeRadio(
                  PlatformType.GROUND,
                  "platform_radio_ground"
                )}
              </mwc-formfield>
              <mwc-formfield label="Aerial">
                ${makePlatformTypeRadio(
                  PlatformType.AERIAL,
                  "platform_radio_uav"
                )}
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
                id="notes"
                cols="3"
                value="${this.metadata?.notes ?? ""}"
                @change="${(event: Event) =>
                  this.updateMetadataFromEvent(event, "notes")}"
              >
              </mwc-textarea>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * @inheritDoc
   */
  protected updated(_changedProperties: PropertyValues) {
    if (this.userModified && _changedProperties.has("metadata")) {
      // Update with the values that the user entered.
      this.dispatchEvent(
        new CustomEvent<EditableMetadata>(
          MetadataForm.FORM_CHANGED_EVENT_NAME,
          {
            bubbles: true,
            composed: true,
            detail: this.metadata as EditableMetadata,
          }
        )
      );
    }
  }
}

/**
 * Extension of `MetadataForm` that connects to Redux.
 */
export class ConnectedMetadataForm extends connect(store, MetadataForm) {
  /**
   * @inheritDoc
   */
  mapState(state: RootState): { [p: string]: any } {
    // Map to loading status to whether we're showing the form.
    const toFormState = new Map<MetadataInferenceStatus, FormState>([
      [MetadataInferenceStatus.NOT_STARTED, FormState.INACTIVE],
      [MetadataInferenceStatus.LOADING, FormState.LOADING],
      [MetadataInferenceStatus.COMPLETE, FormState.READY],
    ]);

    // Update the displayed metadata, if the user hasn't changed it.
    const showMetadata = this.userModified
      ? this.metadata
      : state.uploads.metadata;

    return {
      metadata: showMetadata,
      state: toFormState.get(state.uploads.metadataStatus),
      // Don't track user updates if the dialog is closed.
      userModified: state.uploads.dialogOpen ? this.userModified : false,
    };
  }

  /**
   * @inheritDoc
   */
  mapEvents(): { [p: string]: (event: Event) => Action } {
    const handlers: { [p: string]: (event: Event) => Action } = {};

    handlers[MetadataForm.FORM_CHANGED_EVENT_NAME] = (event: Event) =>
      setMetadata((event as CustomEvent<EditableMetadata>).detail);

    return handlers;
  }
}

/**
 * Extension of `MetadataForm` that connects to Redux and is designed to
 * support editing for selected artifacts.
 */
export class ConnectedMetadataEditingForm extends connect(store, MetadataForm) {
  static readonly tagName: string = "metadata-editing-form";

  /**
   * @inheritDoc
   */
  mapState(state: any): { [p: string]: any } {
    // Update the displayed metadata based on the selected items.
    const ids = thumbnailGridSelectors.selectIds(state);
    let showMetadata = this.metadata;
    if (!this.userModified) {
      // If the user has not set custom metadata, read it from the selected
      // images.
      for (const id of ids) {
        const imageEntity = thumbnailGridSelectors.selectById(state, id);
        if (imageEntity?.isSelected) {
          showMetadata = imageEntity.metadata
            ? filterOnlyEditable(imageEntity.metadata)
            : null;
          break;
        }
      }
    }

    return {
      metadata: showMetadata,
      // When editing, we always show the form.
      state: FormState.READY,
      // Don't track user updates if the dialog is closed.
      userModified: state.imageView.editingDialogOpen
        ? this.userModified
        : false,
    };
  }
}
