import { LitElement } from "lit";
import { ConnectedArtifactThumbnail } from "./artifact-thumbnail";
import { ConnectedThumbnailGrid } from "./thumbnail-grid";
import { ConnectedFileUploader } from "./file-uploader";
import { FileListDisplay } from "./file-list-display";
import { ConnectedMetadataForm } from "./metadata-form";
import { ConnectedLargeImageDisplay } from "./large-image-display";
import { ConnectedMallardApp } from "./mallard-app";
import { ConnectedSearchBox } from "./search-box";
import { ConnectedTopNavBar } from "./top-nav-bar";
import { ConnectedThumbnailGridSection } from "./thumbnail-grid-section";
import { ConnectedArtifactDetails } from "./artifact-details";
import { ConnectedMetadataCard } from "./metadata-card";
import { ConnectedNotesCard } from "./notes-card";

type LitElementType = typeof LitElement;
interface ComponentType extends LitElementType {
  /** Name of the element tag. */
  tagName: string;
}

/** List of all custom elements. */
const componentClasses: ComponentType[] = [
  ConnectedThumbnailGridSection,
  ConnectedThumbnailGrid,
  ConnectedArtifactThumbnail,
  ConnectedFileUploader,
  FileListDisplay,
  ConnectedMetadataForm,
  ConnectedLargeImageDisplay,
  ConnectedMallardApp,
  ConnectedSearchBox,
  ConnectedTopNavBar,
  ConnectedArtifactDetails,
  ConnectedMetadataCard,
  ConnectedNotesCard,
];

/**
 * Registers all known web components as custom elements.
 */
export function registerComponents() {
  for (const component of componentClasses) {
    customElements.define(component.tagName, component);
  }
}
