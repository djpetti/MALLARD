import { css, html, nothing } from "lit";
import { property, query } from "lit/decorators.js";
import "@material/mwc-icon-button";
import "@material/mwc-icon-button-toggle";
import "./artifact-thumbnail";
import { connect } from "@captaincodeman/redux-connect-element";
import store from "./store";
import { RootState } from "./types";
import {
  setSectionExpanded,
  thumbnailGridSelectors,
  thunkClearEntities,
  thunkLoadThumbnails,
  thunkSelectImages,
} from "./thumbnail-grid-slice";
import { Action } from "redux";
import { VisibilityCheckingContainer } from "./visibility-checking-container";
import { ArtifactThumbnail } from "./artifact-thumbnail";

/** Custom event indicating that the selection status has changed. */
type SelectedEvent = CustomEvent<boolean>;

/**
 * A grid of thumbnails with a section header.
 * @customElement thumbnail-grid-section
 */
export class ThumbnailGridSection extends VisibilityCheckingContainer {
  /** Tag name for this element. */
  static readonly tagName: string = "thumbnail-grid-section";

  /**
   * Name for the custom event signaling that we should reload data
   * that we previously unloaded for memory savings.
   */
  static readonly RELOAD_DATA_EVENT_NAME = `${ThumbnailGridSection.tagName}-reload-data`;
  /**
   * Name for the custom event signaling that we want to delete some data.
   */
  static readonly DELETE_DATA_EVENT_NAME = `${ThumbnailGridSection.tagName}-delete-data`;

  static styles = css`
    :host {
      display: block;
      position: relative;
    }

    #section_contents {
      display: grid;
      /* Default to 4/3 aspect ratio. */
      grid-template-columns: repeat(auto-fill, minmax(133px, 1fr));
      grid-gap: 0;
    }

    #section_divider {
      background-color: var(--theme-primary);
      color: var(--theme-whitish);
      padding: 1rem;
      width: 100%;
      border: none;
      text-align: left;
      outline: none;
      font-family: "Roboto";
      font-style: normal;
    }

    .action-buttons {
      position: absolute;
      top: 0;
      right: 0;
      color: var(--theme-whitish);
    }
  `;

  /** Event indicating that the user has clicked the select button. */
  static readonly SELECT_TOGGLED_EVENT_NAME = `${ThumbnailGridSection.tagName}-selected`;

  /** Event indicating that the user has clicked the expand/collapse button. */
  static readonly EXPAND_TOGGLED_EVENT_NAME = `${ThumbnailGridSection.tagName}-expand-or-collapse`;

  /**
   * The header to use for this section.
   */
  @property({ type: String })
  sectionHeader: string = "Section Header";

  /**
   * The unique IDs of the artifacts whose thumbnails are displayed in this component.
   */
  @property({ type: Array })
  displayedArtifacts: string[] = [];

  /** Whether this section is selected. */
  @property({ type: Boolean })
  selected: boolean = false;

  /** Whether this section is expanded. */
  @property({ type: Boolean })
  expanded: boolean = true;

  /** Parent element containing the section contents. */
  @query("#section_contents", true)
  private sectionContents!: HTMLDivElement;

  /**
   * @inheritDoc
   */
  protected override getParentElement(): HTMLElement {
    return this.sectionContents;
  }

  /**
   * @inheritDoc
   */
  protected override onChildrenVisible(_children: Element[]) {
    // Load the thumbnails.
    this.dispatchEvent(
      new CustomEvent<string[]>(ThumbnailGridSection.RELOAD_DATA_EVENT_NAME, {
        bubbles: true,
        composed: false,
        detail: _children.map(
          (c) => (c as ArtifactThumbnail).frontendId as string
        ),
      })
    );
  }

  /**
   * @inheritDoc
   */
  protected override onChildrenNotVisible(_children: Element[]) {
    // Clear the thumbnails.
    this.dispatchEvent(
      new CustomEvent<string[]>(ThumbnailGridSection.DELETE_DATA_EVENT_NAME, {
        bubbles: true,
        composed: false,
        detail: _children.map(
          (c) => (c as ArtifactThumbnail).frontendId as string
        ),
      })
    );
  }

  /**
   * Run whenever the select button is clicked.
   * @private
   */
  private onSelect(): void {
    this.selected = !this.selected;

    // Indicate that the selection status changed.
    this.dispatchEvent(
      new CustomEvent<boolean>(ThumbnailGridSection.SELECT_TOGGLED_EVENT_NAME, {
        bubbles: true,
        composed: false,
        detail: this.selected,
      })
    );
  }

  /**
   * Run whenever the expand/collapse button is clicked.
   * @private
   */
  private onExpandOrCollapse(): void {
    this.expanded = !this.expanded;

    // Indicate that the selection status changed.
    this.dispatchEvent(
      new CustomEvent<boolean>(ThumbnailGridSection.EXPAND_TOGGLED_EVENT_NAME, {
        bubbles: true,
        composed: false,
        detail: this.expanded,
      })
    );

    if (this.expanded) {
      // Reload unloaded data if necessary and enable tracking.
      this.enableVisibilityTracking();
    } else {
      // If it's collapsed, clear those data to save memory and disable
      // tracking.
      this.disableVisibilityTracking();
      this.clearThumbnails();
    }
  }

  /**
   * Clears the thumbnail data for this section to save memory.
   */
  public clearThumbnails(): void {
    this.dispatchEvent(
      new CustomEvent<string[]>(ThumbnailGridSection.DELETE_DATA_EVENT_NAME, {
        bubbles: true,
        composed: false,
        detail: this.displayedArtifacts,
      })
    );
  }

  /**
   * Reloads previously-cleared thumbnail data for this section, if necessary.
   */
  public reloadThumbnails(): void {
    if (!this.expanded) {
      // If it's not even expanded, there's no point in reloading.
      return;
    }

    this.dispatchEvent(
      new CustomEvent<string[]>(ThumbnailGridSection.RELOAD_DATA_EVENT_NAME, {
        bubbles: true,
        composed: false,
        detail: this.displayedArtifacts,
      })
    );
  }

  /**
   * @inheritDoc
   */
  public override enableVisibilityTracking() {
    // Allow this only if the element has been updated. (It will be
    // automatically enabled after the first update.) Also, don't allow
    // tracking to be enabled on collapsed sections.
    if (!this.hasUpdated || !this.expanded) {
      return;
    }

    super.enableVisibilityTracking();
  }

  /**
   * @inheritDoc
   */
  protected render() {
    // Icon to use for the select button.
    const selectIcon = this.selected
      ? "check_circle"
      : "radio_button_unchecked";

    return html`
      ${this.displayedArtifacts.length > 0
        ? html` <div id="section_divider">
            ${this.sectionHeader}
            <span class="action-buttons">
              <!-- Selection button -->
              <mwc-icon-button
                id="select_button"
                icon="${selectIcon}"
                @click="${this.onSelect}"
              ></mwc-icon-button>
              <!-- Expand/collapse button -->
              <mwc-icon-button-toggle
                ?on="${this.expanded}"
                id="collapse_button"
                onIcon="expand_more"
                offIcon="expand_less"
                @click="${this.onExpandOrCollapse}"
              ></mwc-icon-button-toggle>
            </span>
          </div>`
        : nothing}
      <div id="section_contents">
        ${this.expanded
          ? html` ${this.displayedArtifacts.map(
              (i) =>
                html` <artifact-thumbnail
                  .frontendId=${i}
                ></artifact-thumbnail>`
            )}`
          : nothing}
      </div>
    `;
  }
}

/**
 * Extension of `ThumbnailGridSection` that connects to Redux.
 */
export class ConnectedThumbnailGridSection extends connect(
  store,
  ThumbnailGridSection
) {
  /**
   * @inheritDoc
   */
  mapState(state: RootState): { [p: string]: any } {
    // Check to see if all of our images are selected.
    let allSelected = true;
    for (const imageId of this.displayedArtifacts) {
      if (!thumbnailGridSelectors.selectById(state, imageId)?.isSelected) {
        allSelected = false;
        break;
      }
    }

    // Check to see if this section is collapsed.
    const collapsed =
      state.imageView.collapsedSections[this.sectionHeader] === true;

    return { selected: allSelected, expanded: !collapsed };
  }

  /**
   * @inheritDoc
   */
  mapEvents(): { [p: string]: (event: Event) => Action } {
    const handlers: { [p: string]: (event: Event) => Action } = {};

    // The fancy casting here is a hack to deal with the fact that thunkLoadThumbnail
    // produces an AsyncThunkAction but mapEvents is typed as requiring an Action.
    // However, it still works just fine with an AsyncThunkAction.
    handlers[ConnectedThumbnailGridSection.SELECT_TOGGLED_EVENT_NAME] = (
      event: Event
    ) =>
      thunkSelectImages({
        imageIds: this.displayedArtifacts,
        select: (event as SelectedEvent).detail,
      }) as unknown as Action;
    handlers[ConnectedThumbnailGridSection.EXPAND_TOGGLED_EVENT_NAME] = (
      event: Event
    ) =>
      setSectionExpanded({
        sectionName: this.sectionHeader,
        expand: (event as CustomEvent<boolean>).detail,
      });
    handlers[ConnectedThumbnailGridSection.RELOAD_DATA_EVENT_NAME] = (
      event: Event
    ) => {
      return thunkLoadThumbnails(
        (event as CustomEvent<string[]>).detail
      ) as unknown as Action;
    };
    handlers[ConnectedThumbnailGridSection.DELETE_DATA_EVENT_NAME] = (
      event: Event
    ) => {
      return thunkClearEntities(
        (event as CustomEvent<string[]>).detail
      ) as unknown as Action;
    };

    return handlers;
  }
}
