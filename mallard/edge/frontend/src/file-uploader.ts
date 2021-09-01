import { css, html, LitElement, property, PropertyValues } from "lit-element";
import "@material/mwc-icon";
import "@material/mwc-fab";
import { query } from "lit-element/lib/decorators.js";
import { FileListDisplay } from "./file-list-display";
import { connect } from "@captaincodeman/redux-connect-element";
import store from "./store";
import { FileStatus, FrontendFileEntity, RootState } from "./types";
import {
  fileDropZoneEntered,
  fileDropZoneExited,
  processSelectedFiles,
  thunkInferMetadata,
  thunkUploadFile,
  uploadSelectors,
} from "./upload-slice";
import { Action } from "redux";

/**
 * An element that allows the user to select and upload files.
 */
export class FileUploader extends LitElement {
  /** Tag name for this element. */
  static tagName: string = "file-uploader";
  static styles = css`
    :host {
      height: 100%;
    }

    .hidden {
      display: none;
    }

    /** Content on the bottom layer is scrollable and occluded by
     content on top. */
    .bottom_layer {
      position: relative;
      z-index: 5;
      background-color: var(--theme-light-gray);
      overflow: auto;
    }

    /** Content on the top layer doesn't scroll. */
    .top_layer {
      position: fixed;
      z-index: 10;
    }

    .drop_zone {
      height: 100px;
      border-radius: 25px;
      padding: 20px 0;
      border-width: 5px;
      border-style: dashed;

      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      align-items: center;
    }

    /** Show shadow only along bottom of the drop zone. */
    #drop_zone_container {
      min-width: 500px;
      padding-bottom: 10px;
      margin-left: -24px;
      margin-right: -24px;
    }

    /** Place the drop zone on its own plane above the other content. */
    #drop_zone_card {
      padding: 5px 24px 40px 24px;
      background: white;
    }

    .file_list {
      min-width: 500px;
      height: 100%;
      margin-left: -24px;
      margin-right: -24px;
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

    #browse {
      position: absolute;
      z-index: 15;
      top: 167px;
      left: 85%;
    }

    #file_list {
      position: absolute;
      top: 200px;
      width: 100%;
    }
  `;

  /** Maximum number of files we are allowed to upload simultaneously. */
  static MAX_CONCURRENT_UPLOADS = 3;

  /** Name for the custom event signalling that new files are ready to start uploading. */
  static UPLOAD_READY_EVENT_NAME = "upload-ready";
  /** Name for the custom event signalling that we are ready to infer metadata. */
  static METADATA_INFERENCE_READY_EVENT_NAME = "meta-inference-ready";
  /** Name for the event signaling that the user has dragged a file into
   * or out of the upload drop zone. */
  static DROP_ZONE_DRAGGING_EVENT_NAME = "upload-drop-zone-dragging";
  /** Name for the event signaling that the user has selected new files.
   */
  static FILES_SELECTED_EVENT_NAME = "file-selected";

  /**
   * Keeps track of whether the user is actively dragging something
   * over the drop target.
   */
  @property({ attribute: false })
  protected isDragging: boolean = false;

  /** The raw file list data that the user last uploaded. */
  @property({ attribute: false })
  protected selectedFiles: File[] = [];

  /**
   * The list of files that are currently being uploaded.
   */
  @property({ attribute: false })
  uploadingFiles: FrontendFileEntity[] = [];

  @query("#file_list", true)
  private fileList!: FileListDisplay;

  @query("#file_input", true)
  private fileInput!: HTMLInputElement;

  /**
   * Helper function that converts a `DataTransferItemList` to an array of files.
   * @param {DataTransferItemList} dataTransfer The `DataTransferItemList` to convert.
   * @return {File[]} The array of file objects.
   * @private
   */
  private static getFilesFromDataTransfer(
    dataTransfer?: DataTransferItemList
  ): File[] {
    if (dataTransfer == undefined) {
      // File list is empty.
      return [];
    }

    const validFiles: File[] = [];
    for (const item of dataTransfer) {
      const asFile = item.getAsFile();
      if (asFile !== null) {
        validFiles.push(asFile);
      }
    }

    return validFiles;
  }

  /**
   * @inheritDoc
   */
  protected render() {
    // React to drag events.
    const dropZoneClass: string = this.isDragging ? "active_drag" : "no_drag";

    return html`
      <link rel="stylesheet" href="./static/mallard-edge.css" />

      <!-- File input to use for manually selecting files. -->
      <input
        type="file"
        id="file_input"
        class="hidden"
        multiple
        @change="${(_: Event) => {
          // Because FileList cannot be constructed manually, this
          // line is really hard to test.
          // istanbul ignore next
          this.selectedFiles = [...(this.fileInput.files ?? [])];
        }}"
      />

      <div id="drop_zone_container" class="top_layer">
        <div id="drop_zone_card" class="mdc-elevation--z2">
          <div
            id="upload_drop_zone"
            class="drop_zone ${dropZoneClass}"
            @dragenter="${(event: Event) => {
              event.preventDefault();
              this.isDragging = true;
            }}"
            @dragleave="${(event: Event) => {
              event.preventDefault();
              this.isDragging = false;
            }}"
            @dragover="${
              // This is needed to suppress default behavior in the
              // browser, but we have no good way of testing that.
              // istanbul ignore next
              (event: Event) => event.preventDefault()
            }"
            @drop="${(event: DragEvent) => {
              event.preventDefault();
              this.selectedFiles = FileUploader.getFilesFromDataTransfer(
                event.dataTransfer?.items
              );
              this.isDragging = false;
            }}"
          >
            <mwc-icon id="upload_icon" class="${dropZoneClass}"
              >upload_file
            </mwc-icon>
            <div class="break"></div>
            <p id="upload_help" class="${dropZoneClass}">
              Drag files here to upload.
            </p>
          </div>
        </div>

        <mwc-fab
          icon="add"
          id="browse"
          @click="${(_: Event) => this.fileInput.click()}"
        ></mwc-fab>
      </div>

      <div class="file_list bottom_layer">
        <file-list id="file_list"></file-list>
      </div>
    `;
  }

  /**
   * Checks how many uploads are actually running. If it is
   * less than the maximum number, it will suggest new files
   * to start uploading.
   * @return {FrontendFileEntity[]} The list of files to start
   * uploading.
   * @private
   */
  private findFilesToUpload(): FrontendFileEntity[] {
    // Separate into pending and processing uploads.
    const pending: FrontendFileEntity[] = [];
    const processing: FrontendFileEntity[] = [];
    for (const file of this.uploadingFiles) {
      if (file.status == FileStatus.PENDING) {
        pending.push(file);
      } else if (file.status == FileStatus.PROCESSING) {
        processing.push(file);
      }
    }

    // Determine if we should start uploading new files.
    if (processing.length < FileUploader.MAX_CONCURRENT_UPLOADS) {
      // Start uploading some pending files.
      const numToUpload =
        FileUploader.MAX_CONCURRENT_UPLOADS - processing.length;
      return pending.slice(0, numToUpload);
    }

    // No need to start more uploads.
    return [];
  }

  /**
   * @inheritDoc
   */
  protected updated(_changedProperties: PropertyValues) {
    if (_changedProperties.has("uploadingFiles")) {
      // Update the list of files.
      this.fileList.files = this.uploadingFiles;

      const newUploads = this.findFilesToUpload();
      // Determine if we should perform metadata inference.
      if (newUploads.length !== 0) {
        this.dispatchEvent(
          new CustomEvent<string>(
            FileUploader.METADATA_INFERENCE_READY_EVENT_NAME,
            {
              bubbles: true,
              composed: true,
              detail: newUploads[0].id,
            }
          )
        );
      }

      // Determine if we should start any new uploads.
      for (const file of newUploads) {
        this.dispatchEvent(
          new CustomEvent<string>(FileUploader.UPLOAD_READY_EVENT_NAME, {
            bubbles: true,
            composed: true,
            detail: file.id,
          })
        );
      }
    }

    // Handle updating the state when dragging starts and finishes.
    if (_changedProperties.has("isDragging")) {
      this.dispatchEvent(
        new CustomEvent<boolean>(FileUploader.DROP_ZONE_DRAGGING_EVENT_NAME, {
          bubbles: true,
          composed: true,
          detail: this.isDragging,
        })
      );
    }
    if (_changedProperties.has("selectedFiles")) {
      this.dispatchEvent(
        new CustomEvent<File[]>(FileUploader.FILES_SELECTED_EVENT_NAME, {
          bubbles: true,
          composed: true,
          detail: this.selectedFiles,
        })
      );
    }
  }
}

/**
 * Extension of `FileUploader` that connects to Redux.
 */
export class ConnectedFileUploader extends connect(store, FileUploader) {
  /**
   * @inheritDoc
   */
  mapState(state: RootState): { [p: string]: any } {
    const allFiles: FrontendFileEntity[] = uploadSelectors.selectAll(state);
    return {
      uploadingFiles: allFiles,
    };
  }

  /**
   * @inheritDoc
   */
  mapEvents(): { [p: string]: (event: Event) => Action } {
    const handlers: { [p: string]: (event: Event) => Action } = {};

    handlers[ConnectedFileUploader.DROP_ZONE_DRAGGING_EVENT_NAME] = (
      event: Event
    ) =>
      (event as CustomEvent<boolean>).detail
        ? fileDropZoneEntered(null)
        : fileDropZoneExited(null);
    handlers[ConnectedFileUploader.FILES_SELECTED_EVENT_NAME] = (
      event: Event
    ) => {
      // TODO (danielp) Re-enable testing once JSDom supports drag-and-drop.
      // istanbul ignore next
      const fileList =
        (event as CustomEvent<File[]>).detail ?? new DataTransferItemList();
      return processSelectedFiles(fileList);
    };

    // The fancy casting here is a hack to deal with the fact that thunkReadFiles
    // produces an AsyncThunkAction but mapEvents is typed as requiring an Action.
    // However, it still works just fine with an AsyncThunkAction.
    handlers[ConnectedFileUploader.UPLOAD_READY_EVENT_NAME] = (event: Event) =>
      thunkUploadFile(
        (event as CustomEvent<string>).detail
      ) as unknown as Action;
    handlers[ConnectedFileUploader.METADATA_INFERENCE_READY_EVENT_NAME] = (
      event: Event
    ) =>
      thunkInferMetadata(
        (event as CustomEvent<string>).detail
      ) as unknown as Action;

    return handlers;
  }
}
