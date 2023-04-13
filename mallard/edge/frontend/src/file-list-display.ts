import { LitElement, html, TemplateResult, css } from "lit";
import { property } from "lit/decorators.js";
import "@material/mwc-list";
import "@material/mwc-list/mwc-list-item";
import "@material/mwc-icon";
import "@material/mwc-circular-progress";
import { FileStatus, FrontendFileEntity } from "./types";
import "./image-display";

/**
 * An element that displays a list of files, with provisions for
 * files that are being currently processed.
 * @customElement file-list
 */
export class FileListDisplay extends LitElement {
  /** Tag name for this element. */
  static tagName: string = "file-list";
  static styles = css`
    /** Styles for "pending" uploads to make them stand out less. */
    image-display.inactive {
      -webkit-filter: grayscale(100%);
      filter: grayscale(100%);
    }

    span.inactive {
      color: var(--theme-gray);
    }
  `;

  /** Order that we display files with various statuses in. */
  static FILE_DISPLAY_ORDER = [
    FileStatus.UPLOADING,
    FileStatus.AWAITING_UPLOAD,
    FileStatus.PRE_PROCESSING,
    FileStatus.PENDING,
    FileStatus.COMPLETE,
  ];

  /**
   * The set of all files currently displayed.
   */
  @property({ attribute: false })
  files: FrontendFileEntity[] = [];

  /**
   * Groups files by their current status.
   * @param {FrontendFileEntity[]} files The files to group.
   * @return {Map<FileStatus, FrontendFileEntity>[]} Mapping from statuses to the list of
   *  files that have that status.
   * @private
   */
  private static groupByStatus(
    files: FrontendFileEntity[]
  ): Map<FileStatus, FrontendFileEntity[]> {
    const groupedFiles = new Map<FileStatus, FrontendFileEntity[]>();
    for (const file of files) {
      if (!groupedFiles.has(file.status)) {
        // Create a new group.
        groupedFiles.set(file.status, []);
      }
      (groupedFiles.get(file.status) as FrontendFileEntity[]).push(file);
    }

    return groupedFiles;
  }

  /**
   * Sorts files in the order that they should be displayed in, from the top down.
   * @param {FrontendFileEntity[]} files The files to sort.
   * @return {FrontendFileEntity[]} The sorted files.
   * @private
   */
  private static sortFiles(files: FrontendFileEntity[]): FrontendFileEntity[] {
    // First, group the files by status.
    const filesByStatus = this.groupByStatus(files);

    // Sort each group by name.
    filesByStatus.forEach((groupFiles, _) => {
      groupFiles.sort((a, b) => {
        return a.name.localeCompare(b.name);
      });
    });

    // Now, grab each group in the correct order.
    const orderedGroups: FrontendFileEntity[][] = [];
    for (const status of this.FILE_DISPLAY_ORDER) {
      const groupFiles = filesByStatus.get(status);
      if (groupFiles !== undefined) {
        orderedGroups.push(groupFiles);
      }
    }

    const sortedFiles: FrontendFileEntity[] = [];
    return Array.prototype.concat.apply(sortedFiles, orderedGroups);
  }

  /**
   * Generates the HTML to render a specific list item.
   * @param {FileStatus} file The file that we are rendering an item for.
   * @return {TemplateResult} The HTML for this list item.
   * @private
   */
  private static renderItem(file: FrontendFileEntity): TemplateResult {
    // Choose the proper icon based on the status.
    let statusIcon = null;
    let childClass = "";
    switch (file.status) {
      case FileStatus.UPLOADING: {
        statusIcon = html`<mwc-circular-progress
          slot="meta"
          indeterminate
          density="-6"
        ></mwc-circular-progress>`;
        break;
      }
      case FileStatus.COMPLETE: {
        statusIcon = html`<mwc-icon slot="meta">check_circle</mwc-icon>`;
        break;
      }
      default: {
        statusIcon = html`<mwc-icon slot="meta">pending</mwc-icon>`;
        // Make sure children are styled to draw less attention.
        childClass = "inactive";
        break;
      }
    }

    return html`
      <mwc-list-item graphic="medium" hasMeta noninteractive>
        <span class="${childClass}">${file.name}</span>
        <image-display
          .imageUrl=${file.thumbnailUrl ?? undefined}
          slot="graphic"
          class="${childClass}"
        ></image-display>
        ${statusIcon}
      </mwc-list-item>
      <li divider padded role="separator"></li>
    `;
  }

  /**
   * @inheritDoc
   */
  protected render() {
    // Make sure to render files in a canonical order.
    const sortedFiles = FileListDisplay.sortFiles(this.files);

    return html`
      <mwc-list> ${sortedFiles.map(FileListDisplay.renderItem)} </mwc-list>
    `;
  }
}
