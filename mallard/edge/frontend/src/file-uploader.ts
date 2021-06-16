import { css, html, LitElement, property } from "lit-element";
import "@material/mwc-icon"

/**
 * An element that allows the user to select and upload files.
 */
export class FileUploader extends LitElement {
  /** Tag name for this element. */
  static tagName: string = "file-uploader";
  static styles = css`
    .drop_zone {
      min-width: 500px;
      min-height: 100px;
      border-radius: 25px;
      padding: 20px 0;
      border-width: 5px;
      border-style: dashed;

      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      align-items: center;
    }

    .file_list {
      min-width: 500px;
      min-height: 100px;
    }

    #upload_icon {
      --mdc-icon-size: 75px;
    }

    #upload_help {
      font-family: "Roboto", sans-serif;
      font-weight: 200;
    }

    /* Allows us to force a new row in a flexbox layout. */
    .break {
      flex-basis: 100%;
      height: 0;
    }

    /* Styles UI when no file is being dragged. */
    .no_drag {
      border-color: var(--theme-gray);
      color: var(--theme-gray);
    }

    /** Styles UI when a file is being dragged. */
    .active_drag {
      border-color: var(--theme-primary);
      color: var(--theme-primary);
    }
  `;

  /**
   * Keeps track of whether the user is actively dragging something
   * over the drop target.
   */
  @property({ type: Boolean, attribute: false })
  isDragging: boolean = false;

  /**
   * Handles the drop event over the drop zone.
   * @param {Event} event The event to handle.
   * @protected
   */
  protected handleDrop(event: Event) {
    console.log("Got drop event: " + event);
    event.preventDefault();
  }

  /**
   * Handles the user dragging something over the drop zone.
   * @param {Event} event The event to handle.
   * @protected
   */
  protected handleDragEnter(event: Event) {
    event.preventDefault();
    this.isDragging = true;
  }

  /**
   * Handles the user dragging something out of the drop zone.
   * @param {Event} event The event to handle.
   * @protected
   */
  protected handleDragLeave(event: Event) {
    event.preventDefault();
    this.isDragging = false;
  }

  /**
   * @inheritDoc
   */
  protected render() {
    // React to drag events.
    const dropZoneClass: string = this.isDragging ? "active_drag" : "no_drag";

    return html`
      <link rel="stylesheet" href="./static/mallard-edge.css">
      <div
        id="upload_drop_zone"
        class="drop_zone ${dropZoneClass}"
        @drop="${this.handleDrop}"
        @dragenter="${this.handleDragEnter}"
        @dragleave="${this.handleDragLeave}"
      >
        <mwc-icon id="upload_icon" class="${dropZoneClass}"
          >upload_file</mwc-icon
        >
        <div class="break"></div>
        <p id="upload_help" class="${dropZoneClass}">
          Drag files here to upload.
        </p>
      </div>
      <div class="file_list mdc-elevation--z2"></div>
    `;
  }
}
