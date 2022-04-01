import { ThumbnailGridSection } from "./thumbnail-grid-section";
import { LitElement } from "lit-element";
import { ConnectedArtifactThumbnail } from "./artifact-thumbnail";
import { ConnectedThumbnailGrid } from "./thumbnail-grid";
import { ConnectedFileUploader } from "./file-uploader";
import { FileListDisplay } from "./file-list-display";
import { ConnectedMetadataForm } from "./metadata-form";
import { ConnectedLargeImageDisplay } from "./large-image-display";
import { TopNavBar } from "./top-nav-bar";
import { ConnectedMallardApp } from "./mallard-app";

type LitElementType = typeof LitElement;
interface ComponentType extends LitElementType {
  /** Name of the element tag. */
  tagName: string;
}

/** List of all custom elements. */
const componentClasses: ComponentType[] = [
  ThumbnailGridSection,
  ConnectedThumbnailGrid,
  ConnectedArtifactThumbnail,
  ConnectedFileUploader,
  FileListDisplay,
  ConnectedMetadataForm,
  ConnectedLargeImageDisplay,
  TopNavBar,
  ConnectedMallardApp,
];

/**
 * Registers all known web components as custom elements.
 */
export function registerComponents() {
  for (const component of componentClasses) {
    customElements.define(component.tagName, component);
  }
}
