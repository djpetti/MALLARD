import { css, html, nothing, PropertyValues } from "lit";
import { state, property } from "lit/decorators.js";
import { connect } from "@captaincodeman/redux-connect-element";
import store from "./store";
import { ImageEntity, RootState, ImageStatus } from "./types";
import {
  selectImages,
  thumbnailGridSelectors,
  thunkLoadThumbnail,
} from "./thumbnail-grid-slice";
import { Action } from "redux";
import { ImageChangedEvent, ImageDisplay } from "./image-display";
import "@material/mwc-icon-button";

/** Custom event indicating that the selection status has changed. */
type SelectedEvent = CustomEvent<boolean>;

/**
 * Thumbnail representation of an uploaded artifact.
 * @customElement artifact-thumbnail
 */
export class ArtifactThumbnail extends ImageDisplay {
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
      z-index: 99;
      top: -10px;
      right: -10px;
      animation-name: fade;
      animation-duration: 0.25s;
    }

    .button-unselected {
      color: var(--theme-whitish);
    }

    .button-selected {
      color: var(--theme-secondary-1-light);
    }

    ${ImageDisplay.styles}
  `;

  static tagName: string = "artifact-thumbnail";

  /** Event indicating that the selection status has changed. */
  protected static readonly SELECTED_EVENT_NAME = `${ArtifactThumbnail.tagName}-selected`;

  /** Whether this thumbnail is selected. */
  @property({ type: Boolean })
  selected: boolean = false;

  /** Whether we are currently hovering over the thumbnail. */
  @state()
  private isHovering: boolean = false;

  /**
   * Run whenever the select button is clicked.
   * @private
   */
  private onSelect(): void {
    this.selected = !this.selected;
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
      ${(this.isHovering || this.selected) && this.hasImage
        ? html`<mwc-icon-button
            id="select_button"
            icon="${selectIcon}"
            slot="actionItems"
            class="${selectClass}"
            @click="${this.onSelect}"
          ></mwc-icon-button>`
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

    if (_changedProperties.has("selected")) {
      // Indicate that the selection status changed.
      this.dispatchEvent(
        new CustomEvent<boolean>(ArtifactThumbnail.SELECTED_EVENT_NAME, {
          bubbles: true,
          composed: false,
          detail: this.selected,
        })
      );
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
   * @param {ImageEntity} entity The image entity to make the URL for.
   * @return {string} The resulting URL.
   * @private
   */
  private static makeDetailsUrl(entity: ImageEntity): string {
    const backendId = entity.backendId;
    return `/details/${backendId.bucket}/${backendId.name}`;
  }

  /**
   * @inheritDoc
   */
  mapState(state: RootState): { [p: string]: any } {
    if (!this.frontendId) {
      // No specific thumbnail has been set.
      return {};
    }

    // This should never be undefined, because that means our image ID is invalid.
    const imageEntity = thumbnailGridSelectors.selectById(
      state,
      this.frontendId
    );
    if (imageEntity === undefined) {
      // The frontendId that was set is apparently invalid.
      return {};
    }
    if (imageEntity.thumbnailStatus != ImageStatus.VISIBLE) {
      // The thumbnail image is has not been loaded yet.
      return {};
    }

    return {
      imageUrl: imageEntity.thumbnailUrl,
      selected: imageEntity.isSelected,
      imageLink: ConnectedArtifactThumbnail.makeDetailsUrl(imageEntity),
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
    handlers[ConnectedArtifactThumbnail.IMAGE_CHANGED_EVENT_NAME] = (
      event: Event
    ) =>
      thunkLoadThumbnail(
        (event as ImageChangedEvent).detail.frontendId as string
      ) as unknown as Action;
    handlers[ConnectedArtifactThumbnail.SELECTED_EVENT_NAME] = (event: Event) =>
      selectImages({
        imageIds: [this.frontendId],
        select: (event as SelectedEvent).detail,
      });
    return handlers;
  }
}
