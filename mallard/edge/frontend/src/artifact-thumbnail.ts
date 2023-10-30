import { css, html, nothing, PropertyValues, TemplateResult } from "lit";
import { state, property } from "lit/decorators.js";
import { connect } from "@captaincodeman/redux-connect-element";
import store from "./store";
import { ArtifactEntity, RootState, ArtifactStatus } from "./types";
import {
  thumbnailGridSelectors,
  thunkSelectImages,
} from "./thumbnail-grid-slice";
import { Action } from "redux";
import { ArtifactDisplay } from "./artifact-display";
import "@material/mwc-icon-button";
import "@material/mwc-icon";
import { ObjectType, UavImageMetadata, UavVideoMetadata } from "mallard-api";

/** Custom event indicating that the selection status has changed. */
type SelectedEvent = CustomEvent<boolean>;

/**
 * Format the duration of a video as a human-readable string.
 * @param {UavVideoMetadata} metadata The video metadata to extract the
 *   duration from.
 * @return {string} The formatted duration, as HH:MM:SS if it is at least an
 *   hour, or MM:SS if it is not.
 */
function formatVideoDuration(metadata: UavVideoMetadata): string {
  // Calculate the total duration in seconds.
  if (metadata.numFrames === undefined || metadata.frameRate === undefined) {
    // If we don't know, don't display anything.
    return "";
  }
  const duration = metadata.numFrames / metadata.frameRate;

  const hours = Math.floor(duration / 3600);
  const minutes = Math.floor((duration % 3600) / 60);
  const seconds = Math.floor(duration % 60);

  const minutesSeconds = `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
  // Only include hours if the duration is at least an hour.
  return hours > 0 ? `${hours}:${minutesSeconds}` : minutesSeconds;
}

/**
 * Thumbnail representation of an uploaded artifact.
 * @customElement artifact-thumbnail
 */
export class ArtifactThumbnail extends ArtifactDisplay {
  static styles = css`
    /* Animation for the padding. */
    @keyframes shrink {
      from {
        padding: 0;
      }
      to {
        padding: 10px;
      }
    }

    .padded {
      animation-name: shrink;
      animation-duration: 0.25s;
      padding: 10px;
    }

    :host {
      display: inline-block;
      margin: 0.5rem;
      min-width: 128px;
      min-height: 80px;
      position: relative;
    }

    .parent-size {
      height: 100%;
    }

    /* Fade animation for the select button. */
    @keyframes fade {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }

    #select_button {
      position: absolute;
      z-index: 6;
      top: -10px;
      right: -10px;
      animation-name: fade;
      animation-duration: 0.25s;
    }

    #video_icon {
      /* Leave some space between icon and text. */
      margin-right: 5px;
    }

    .video_marker {
      display: flex;
      align-items: center;
      color: white;
      position: absolute;
      z-index: 6;
      top: 5px;
      left: 5px;

      font-family: Roboto;
      font-weight: bold;

      opacity: 1;
      transition: opacity 0.25s;
    }

    .marker_hidden {
      opacity: 0;
    }

    .button-unselected {
      color: var(--theme-whitish);
    }

    .button-selected {
      color: var(--theme-secondary-1-light);
    }

    ${ArtifactDisplay.styles}
  `;

  static tagName: string = "artifact-thumbnail";

  /** Event indicating that the selection status has changed. */
  static readonly SELECTED_EVENT_NAME = `${ArtifactThumbnail.tagName}-selected`;

  /** Whether this thumbnail is selected. */
  @property({ type: Boolean })
  selected: boolean = false;

  /**
   * Metadata structure to display information from.
   */
  @property({ type: Object, attribute: false })
  metadata?: UavImageMetadata | UavVideoMetadata;

  /**
   * A URL of the preview video. This is specifically for video artifacts,
   * and generally remains undefined for everything else.
   */
  @property({ type: String })
  previewUrl?: string;

  /** Whether we are currently hovering over the thumbnail. */
  @state()
  private isHovering: boolean = false;

  /**
   * Run whenever the select button is clicked.
   * @param {Event} event The click event.
   * @private
   */
  private onSelect(event: Event): void {
    // Stop propagation so it doesn't interpret this as a click on the
    // thumbnail.
    event.stopPropagation();

    this.selected = !this.selected;

    this.dispatchEvent(
      new CustomEvent<boolean>(ArtifactThumbnail.SELECTED_EVENT_NAME, {
        bubbles: true,
        composed: false,
        detail: this.selected,
      })
    );
  }

  /**
   * @inheritDoc
   */
  protected override renderArtifact(): TemplateResult {
    if (this.isHovering && this.type === ObjectType.VIDEO && this.previewUrl) {
      // If we are hovering over a video, show a preview instead.
      return html`<video
        disablepictureinpicture
        disableremoteplayback
        loop
        muted
        autoplay
        src="${this.previewUrl as string}"
        poster="${this.sourceUrl as string}"
        id="media"
      ></video>`;
    }

    // Always render an image for thumbnails, regardless of the artifact type.
    return this.renderImage();
  }

  /**
   * @inheritDoc
   */
  protected override render() {
    // Icon to use for the select button.
    const selectIcon = this.selected
      ? "check_circle"
      : "radio_button_unchecked";
    const selectClass = this.selected ? "button-selected" : "button-unselected";
    // Whether to show extra padding.
    const paddingClass = this.selected ? "padded" : "";

    const baseHtml = super.render();
    return html` <div class="parent-size">
      <div class="${paddingClass} parent-size">${baseHtml}</div>
      <!-- Selection button -->
      ${(this.isHovering || this.selected) && this.hasContent
        ? html`<mwc-icon-button
            id="select_button"
            icon="${selectIcon}"
            slot="actionItems"
            class="${selectClass}"
            @click="${this.onSelect}"
          ></mwc-icon-button>`
        : nothing}
      <!-- Video indicator -->
      ${this.type === ObjectType.VIDEO
        ? html`<span
            class="video_marker ${this.selected || this.isHovering
              ? "marker_hidden"
              : ""}"
            ><mwc-icon id="video_icon">play_circle_outline</mwc-icon
            >${formatVideoDuration(this.metadata as UavVideoMetadata)}</span
          >`
        : nothing}
    </div>`;
  }

  /**
   * @inheritDoc
   */
  protected override firstUpdated(_changedProperties: PropertyValues) {
    super.firstUpdated(_changedProperties);

    // Add a handler for mousing over the image, so we can show the
    // selection button.
    this.addEventListener("mouseenter", () => (this.isHovering = true));
    this.addEventListener("mouseleave", () => (this.isHovering = false));
  }

  /**
   * @inheritDoc
   */
  protected override updated(_changedProperties: PropertyValues) {
    super.updated(_changedProperties);

    // Muting does not work on dynamically-loaded videos, so we set
    // it manually here.
    // See https://stackoverflow.com/a/51755171
    if (this.media && this.type === ObjectType.VIDEO) {
      (this.media as HTMLVideoElement).muted = true;
    }
  }
}

/**
 * Extension of `ArtifactThumbnail` that connects to Redux.
 */
export class ConnectedArtifactThumbnail extends connect(
  store,
  ArtifactThumbnail
) {
  /**
   * Creates a URL that takes us to a page with details about a particular image.
   * @param {ArtifactEntity} entity The image entity to make the URL for.
   * @return {string} The resulting URL.
   * @private
   */
  private static makeDetailsUrl(entity: ArtifactEntity): string {
    const backendId = entity.backendId;
    return `/details/${backendId.type}/${backendId.id.bucket}/${backendId.id.name}`;
  }

  /**
   * @inheritDoc
   */
  protected override updated(_changedProperties: PropertyValues) {
    super.updated(_changedProperties);

    // If we set a new frontend ID, we should update the other
    // properties from the state, even if the state hasn't changed.
    if (_changedProperties.has("frontendId")) {
      const state = store.getState();
      Object.assign(this, this.mapState(state));
    }
  }

  /**
   * @inheritDoc
   */
  mapState(state: RootState): { [p: string]: any } {
    const defaultState = {
      sourceUrl: undefined,
      selected: false,
      onClickLink: undefined,
      previewUrl: undefined,
    };
    if (!this.frontendId) {
      // No specific thumbnail has been set.
      return defaultState;
    }

    const imageEntity = thumbnailGridSelectors.selectById(
      state,
      this.frontendId
    );
    if (imageEntity === undefined) {
      // The frontendId that was set is apparently invalid.
      return defaultState;
    }
    if (imageEntity.thumbnailStatus != ArtifactStatus.LOADED) {
      // The thumbnail image has not been loaded yet.
      return defaultState;
    }

    return {
      sourceUrl: imageEntity.thumbnailUrl ?? undefined,
      selected: imageEntity.isSelected,
      onClickLink: ConnectedArtifactThumbnail.makeDetailsUrl(imageEntity),
      previewUrl: imageEntity.previewUrl ?? undefined,
      ...this.metadataUpdatesFromState(state),
    };
  }

  /**
   * @inheritDoc
   */
  mapEvents(): { [p: string]: (event: Event) => Action } {
    const handlers: { [p: string]: (event: Event) => Action } = {};

    // The fancy casting here is a hack to deal with the fact that thunkLoadThumbnail
    // produces an AsyncThunkAction but mapEvents is typed as requiring an Action.
    // However, it still works just fine with an AsyncThunkAction.
    handlers[ConnectedArtifactThumbnail.SELECTED_EVENT_NAME] = (event: Event) =>
      thunkSelectImages({
        imageIds: [this.frontendId as string],
        select: (event as SelectedEvent).detail,
      }) as unknown as Action;
    return handlers;
  }
}
