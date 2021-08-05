/**
 * Common utilities for testing Lit elements.
 */

import {
  FileStatus,
  FrontendFileEntity,
  ImageEntity,
  MetadataInferenceStatus,
  RequestState,
  RootState,
  ThumbnailStatus,
} from "../types";
import * as faker from "faker";
import { ObjectRef, UavImageMetadata } from "typescript-axios";

/**
 * Gets the root node in the shadow DOM for an element.
 * @param {string} tagName The tag name of the element. Will get the first element with this tag.
 * @return {ShadowRoot} The root node of the shadow DOM.
 */
export const getShadowRoot = (tagName: string): ShadowRoot => {
  return document.body.getElementsByTagName(tagName)[0]
    .shadowRoot as ShadowRoot;
};

/**
 * Creates a fake Redux state to use for testing.
 * @return {RootState} The state that it created.
 */
export function fakeState(): RootState {
  // Create a fake state.
  return {
    thumbnailGrid: {
      lastQueryResults: null,
      currentQuery: null,
      currentQueryState: RequestState.IDLE,
      currentQueryError: null,
      ids: [],
      entities: {},
    },
    uploads: {
      dialogOpen: false,
      isDragging: false,

      ids: [],
      entities: {},

      metadataStatus: MetadataInferenceStatus.NOT_STARTED,
      metadata: null,
      metadataChanged: false,
    },
  };
}

/**
 * Creates a fake entity in our normalized thumbnail database.
 * @param {boolean} imageLoaded Specify whether to simulate that a particular
 *  thumbnail image has finished loading. If not specified, it will be set randomly.
 * @param {Date} captureDate Specify a specific capture date for this entity.
 * @return {ImageEntity} The entity that it created.
 */
export function fakeThumbnailEntity(
  imageLoaded?: boolean,
  captureDate?: Date
): ImageEntity {
  // Determine whether we should simulate a loaded image or not.
  if (imageLoaded == undefined) {
    imageLoaded = faker.datatype.boolean();
  }
  // Determine whether we should use a specific capture date.
  if (captureDate == undefined) {
    captureDate = faker.date.past();
  }

  let status: ThumbnailStatus = ThumbnailStatus.LOADING;
  let imageUrl: string | null = null;
  let metadata: UavImageMetadata | null = null;
  if (imageLoaded) {
    // Simulate a loaded image.
    status = ThumbnailStatus.VISIBLE;
    imageUrl = faker.image.dataUri();
    metadata = { captureDate: captureDate.toISOString() };
  }

  return {
    backendId: { bucket: faker.lorem.word(), name: faker.datatype.uuid() },
    status: status,
    imageUrl: imageUrl,
    metadata: metadata,
  };
}

/**
 * Creates a fake entity in our normalized upload file database.
 * @param {FileStatus} status If specified, use a specific status for this file.
 * @return {FrontendFileEntity} The entity that it created.
 */
export function fakeFrontendFileEntity(
  status?: FileStatus
): FrontendFileEntity {
  const id = faker.datatype.uuid();
  const iconUrl = faker.image.dataUri();
  const name = faker.system.fileName();
  if (status == undefined) {
    status = faker.random.arrayElement([
      FileStatus.PENDING,
      FileStatus.PROCESSING,
      FileStatus.COMPLETE,
    ]);
  }

  return {
    id: id,
    dataUrl: iconUrl,
    name: name,
    status: status,
  };
}

/**
 * Creates a fake `ObjectRef`.
 * @return {ObjectRef} The random `ObjectRef` that it created.
 */
export function fakeObjectRef(): ObjectRef {
  return {
    bucket: faker.lorem.words(),
    name: faker.datatype.uuid(),
  };
}

/**
 * Creates a fake `ImageMetadata`.
 * @return {UavImageMetadata} The random `ImageMetadata` that it created.
 */
export function fakeFrontendImageMetadata(): UavImageMetadata {
  return {
    name: faker.system.fileName(),
  };
}
