import { LitElement, css, html, nothing } from "lit";
import { property } from "lit/decorators.js";
import "@material/mwc-icon-button";
import "@material/mwc-icon-button-toggle";
import "./artifact-thumbnail";
import { connect } from "@captaincodeman/redux-connect-element";
import store from "./store";
import { RootState } from "./types";
import {
  setSectionExpanded,
  thumbnailGridSelectors,
  thunkSelectImages,
} from "./thumbnail-grid-slice";
import { Action } from "redux";

/** Custom event indicating that the selection status has changed. */
type SelectedEvent = CustomEvent<boolean>;

/**
 * A grid of thumbnails with a section header.
 * @customElement thumbnail-grid-section
 */
export class ThumbnailGridSection extends LitElement {
  /** Tag name for this element. */
  static readonly tagName: string = "thumbnail-grid-section";

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
      z-index: 99;
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
      ${this.expanded
        ? html` <div id="section_contents">
            ${this.displayedArtifacts.map(
              (i) =>
                html` <artifact-thumbnail
                  .frontendId=${i}
                ></artifact-thumbnail>`
            )}
          </div>`
        : nothing}
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

    return handlers;
  }
}
