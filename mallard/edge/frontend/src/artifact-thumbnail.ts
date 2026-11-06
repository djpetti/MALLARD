import { css, html, nothing, PropertyValues, TemplateResult } from "lit";
import { state, property } from "lit/decorators.js";
import store, { RootState } from "./store";
import { ArtifactEntity, ArtifactStatus } from "./types";
import {
  thumbnailGridSelectors,
  thunkSelectImages,
} from "./thumbnail-grid-slice";
import { Action } from "redux";
import { ArtifactDisplay } from "./artifact-display";
import { ObjectType, UavImageMetadata, UavVideoMetadata } from "mallard-api";
import { connectRedux } from "./connected-element";

/** Duration shared by the touch-hold timer and its visual feedback. */
const TOUCH_HOLD_DURATION_MS = 1000;

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
  const duration = (metadata.numFrames ?? 0) / (metadata.frameRate ?? 1);

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
      margin: 0.25rem;
      min-height: 80px;
      position: relative;
    }

    .parent-size {
      height: 100%;
    }

    .hold-feedback {
      transform: scale(1);
      transition: transform 180ms cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    .holding {
      transform: scale(0.85);
      transition: transform ${TOUCH_HOLD_DURATION_MS}ms linear;
    }

    @media (any-pointer: coarse) {
      :host {
        /* Keep native image callouts from interrupting a touch hold. */
        -webkit-touch-callout: none;
        -webkit-user-select: none;
        user-select: none;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .hold-feedback {
        transition: none;
      }
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
      top: -5px;
      right: -5px;
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
      color: var(--md-sys-color-on-primary);
    }

    .button-selected {
      color: var(--md-sys-color-tertiary);
      font-variation-settings: "FILL" 1;
    }

    ${ArtifactDisplay.styles}
  `;

  static tagName: string = "artifact-thumbnail";

  /** Event indicating that the selection status has changed. */
  static readonly SELECTED_EVENT_NAME = `${ArtifactThumbnail.tagName}-selected`;

  /** Event indicating that the item was selected while holding shift. */
  static readonly SHIFT_SELECTED_EVENT_NAME = `${ArtifactThumbnail.tagName}-shift-selected`;

  /** Whether this thumbnail is selected. */
  @property({ type: Boolean })
  selected: boolean = false;

  /** Whether the grid has any selected artifacts. */
  @property({ type: Boolean })
  selectionMode: boolean = false;

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

  /** Whether a touch hold is currently counting down. */
  @state()
  private isHolding: boolean = false;

  private holdTimer?: ReturnType<typeof setTimeout>;
  private holdListeners?: AbortController;
  private holdPointerId?: number;
  private suppressClick: boolean = false;

  /** Registers touch gestures and guards the inherited click navigation. */
  constructor() {
    super();

    this.addEventListener("pointerdown", this.onPointerDown);
    // Capture the compatibility click before the inherited navigation handler.
    this.addEventListener(
      "click",
      (event: MouseEvent) => {
        if (this.suppressClick) {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.suppressClick = false;
        } else if (
          this.selectionMode &&
          !event
            .composedPath()
            .some(
              (target) =>
                target instanceof Element && target.id === "select_button"
            )
        ) {
          // Block navigation before selection updates can exit selection mode.
          event.preventDefault();
          event.stopImmediatePropagation();
          this.cancelHold();
          if (this.hasContent) {
            this.toggleSelection(event.shiftKey);
          }
        }
      },
      { capture: true }
    );
    this.addEventListener("contextmenu", (event: MouseEvent) => {
      if (this.holdPointerId !== undefined || this.suppressClick) {
        event.preventDefault();
      }
    });
  }

  /**
   * Starts a hold for a primary touch on loaded thumbnail content.
   * @param {PointerEvent} event The initiating pointer event.
   */
  private onPointerDown(event: PointerEvent): void {
    this.suppressClick = false;
    if (
      event.pointerType !== "touch" ||
      !event.isPrimary ||
      !this.hasContent ||
      event
        .composedPath()
        .some(
          (target) => target instanceof Element && target.id === "select_button"
        )
    ) {
      return;
    }

    this.cancelHold();
    this.holdPointerId = event.pointerId;
    this.isHolding = true;
    this.holdListeners = new AbortController();
    const options = { signal: this.holdListeners.signal };
    const startX = event.clientX;
    const startY = event.clientY;

    // Observe the gesture outside the thumbnail without disabling native scrolling.
    window.addEventListener(
      "pointermove",
      (move: PointerEvent) => {
        if (
          move.pointerId === this.holdPointerId &&
          Math.hypot(move.clientX - startX, move.clientY - startY) > 10
        ) {
          this.cancelHold();
        }
      },
      options
    );
    const finish = (end: PointerEvent): void => {
      if (end.pointerId === this.holdPointerId) {
        this.cancelHold();
      }
    };
    window.addEventListener("pointerup", finish, options);
    window.addEventListener("pointercancel", finish, options);
    window.addEventListener(
      "pointerdown",
      (other: PointerEvent) => {
        if (other.pointerId !== this.holdPointerId) {
          this.cancelHold();
        }
      },
      options
    );
    window.addEventListener("scroll", () => this.cancelHold(), {
      ...options,
      capture: true,
    });
    window.addEventListener("blur", () => this.cancelHold(), options);

    this.holdTimer = setTimeout(() => {
      this.cancelHold();
      this.suppressClick = true;
      this.toggleSelection();
    }, TOUCH_HOLD_DURATION_MS);
  }

  /** Clears the pending gesture and restores the thumbnail's normal scale. */
  private cancelHold(): void {
    clearTimeout(this.holdTimer);
    this.holdTimer = undefined;
    this.holdListeners?.abort();
    this.holdListeners = undefined;
    this.holdPointerId = undefined;
    this.isHolding = false;
  }

  /** @inheritDoc */
  override disconnectedCallback(): void {
    this.cancelHold();
    this.suppressClick = false;
    super.disconnectedCallback();
  }

  /**
   * Run whenever the select button is clicked.
   * @param {Event} event The click event.
   * @private
   */
  private onSelect(event: MouseEvent): void {
    // Stop propagation so it doesn't interpret this as a click on the
    // thumbnail.
    event.stopPropagation();

    this.toggleSelection(event.shiftKey);
  }

  /**
   * Toggles selection using the same events for mouse and touch input.
   * @param {boolean} shiftKey Whether to extend the selection with Shift.
   */
  private toggleSelection(shiftKey: boolean = false): void {
    this.selected = !this.selected;

    if (this.selected && shiftKey) {
      // We selected something while holding down shift. This should trigger
      // special behavior.
      this.dispatchEvent(
        new CustomEvent<string>(ArtifactThumbnail.SHIFT_SELECTED_EVENT_NAME, {
          bubbles: true,
          composed: true,
          detail: this.frontendId,
        })
      );
    } else {
      this.dispatchEvent(
        new CustomEvent<boolean>(ArtifactThumbnail.SELECTED_EVENT_NAME, {
          bubbles: true,
          composed: false,
          detail: this.selected,
        })
      );
    }
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
    // Whether to show extra padding.
    const paddingClass = this.selected ? "padded" : "";

    const baseHtml = super.render();
    return html`<div class="parent-size">
      <div class="hold-feedback parent-size ${this.isHolding ? "holding" : ""}">
        <div class="${paddingClass} parent-size">${baseHtml}</div>
      </div>
      <!-- Selection button -->
      ${(this.isHovering || this.selected || this.selectionMode) &&
      this.hasContent
        ? html`<md-icon-button
            toggle
            ?selected="${this.selected}"
            id="select_button"
            slot="actionItems"
            @click="${this.onSelect}"
          >
            <md-icon class="button-unselected">radio_button_unchecked</md-icon>
            <md-icon slot="selected" class="button-selected"
              >check_circle</md-icon
            >
          </md-icon-button>`
        : nothing}
      <!-- Video indicator -->
      ${this.type === ObjectType.VIDEO
        ? html`<span
            class="video_marker ${this.selected || this.isHovering
              ? "marker_hidden"
              : ""}"
            ><md-icon id="video_icon">play_circle</md-icon
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

    // A recycled or unloaded thumbnail must not finish an earlier touch gesture.
    if (_changedProperties.has("frontendId") || !this.hasContent) {
      this.cancelHold();
    }

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
export class ConnectedArtifactThumbnail extends connectRedux(
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
      Object.assign(this, this.stateChanged(state));
    }
  }

  /**
   * @inheritDoc
   */
  override stateChanged(state: RootState): void {
    // Reveal selection controls across the grid, not only on selected artifacts.
    this.selectionMode = state.imageView.numItemsSelected > 0;

    // Set defaults.
    this.sourceUrl = undefined;
    this.selected = false;
    this.onClickLink = undefined;
    this.previewUrl = undefined;

    if (!this.frontendId) {
      // No specific thumbnail has been set.
      return;
    }

    const imageEntity = thumbnailGridSelectors.selectById(
      state,
      this.frontendId
    );
    if (imageEntity === undefined) {
      // The frontendId that was set is apparently invalid.
      return;
    }
    if (imageEntity.thumbnailStatus != ArtifactStatus.LOADED) {
      // The thumbnail image has not been loaded yet.
      return;
    }

    this.metadataUpdatesFromState(state);
    this.sourceUrl = imageEntity.thumbnailUrl ?? undefined;
    this.selected = imageEntity.isSelected;
    this.onClickLink = ConnectedArtifactThumbnail.makeDetailsUrl(imageEntity);
    this.previewUrl = imageEntity.previewUrl ?? undefined;
  }

  /**
   * @inheritDoc
   */
  override mapEvents(): { [p: string]: (event: Event) => Action } {
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
