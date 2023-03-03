/**
 * Common utilities for testing Lit elements.
 */

import {
  FileStatus,
  FrontendFileEntity,
  ImageEntity,
  ImageQuery,
  ImageStatus,
  MetadataInferenceStatus,
  RequestState,
  RootState,
} from "../types";
import * as faker from "faker";
import {
  Field,
  ImageFormat,
  ObjectRef,
  Ordering,
  PlatformType,
  UavImageMetadata,
} from "typescript-axios";
import { AutocompleteMenu, Suggestions } from "../autocomplete";

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
    imageView: {
      currentQuery: [],
      currentQueryOptions: {},
      currentQueryState: RequestState.IDLE,
      metadataLoadingState: RequestState.IDLE,
      currentQueryError: null,
      currentQueryHasMorePages: true,
      ids: [],
      entities: {},
      search: {
        searchString: "",
        autocompleteSuggestions: {
          menu: AutocompleteMenu.NONE,
          textCompletions: [],
        },
        queryState: RequestState.IDLE,
      },
    },
    uploads: {
      dialogOpen: false,
      isDragging: false,
      uploadsInProgress: 0,

      ids: [],
      entities: {},

      metadataStatus: MetadataInferenceStatus.NOT_STARTED,
      metadata: null,
      metadataChanged: false,
    },
  };
}

/**
 * Creates a fake entity in our normalized image database.
 * @param {boolean} thumbnailLoaded Specify whether to simulate that a particular
 *  thumbnail image has finished loading. If not specified, it will be set randomly.
 * @param {boolean} imageLoaded Specify whether to simulate that a particular
 *  image has finished loading. If not specified, it will be set randomly.
 * @param {Date} captureDate Specify a specific capture date for this entity.
 * @param {string} sessionName Specify a specific session name for this entity.
 * @return {ImageEntity} The entity that it created.
 */
export function fakeImageEntity(
  thumbnailLoaded?: boolean,
  imageLoaded?: boolean,
  captureDate?: Date,
  sessionName?: string
): ImageEntity {
  // Determine whether we should simulate a loaded image or not.
  if (thumbnailLoaded == undefined) {
    thumbnailLoaded = faker.datatype.boolean();
  }
  if (imageLoaded == undefined) {
    imageLoaded = faker.datatype.boolean();
  }
  // Determine whether we should use a specific capture date.
  if (captureDate == undefined) {
    captureDate = faker.date.past();
  }
  if (sessionName == undefined) {
    sessionName = faker.lorem.words();
  }

  let thumbnailStatus: ImageStatus = ImageStatus.LOADING;
  let imageStatus: ImageStatus = ImageStatus.LOADING;
  let thumbnailUrl: string | null = null;
  let imageUrl: string | null = null;
  let metadata: UavImageMetadata | null = null;
  if (thumbnailLoaded) {
    // Simulate a loaded thumbnail.
    thumbnailStatus = ImageStatus.VISIBLE;
    thumbnailUrl = faker.image.dataUri();
    metadata = {
      captureDate: captureDate.toISOString(),
      sessionName: sessionName,
    };
  }
  if (imageLoaded) {
    // Simulate a loaded image.
    imageStatus = ImageStatus.VISIBLE;
    imageUrl = faker.image.dataUri();
    metadata = {
      captureDate: captureDate.toISOString(),
      sessionName: sessionName,
    };
  }

  return {
    backendId: fakeObjectRef(),
    thumbnailStatus: thumbnailStatus,
    imageStatus: imageStatus,
    thumbnailUrl: thumbnailUrl,
    imageUrl: imageUrl,
    metadata: metadata,
    isSelected: faker.datatype.boolean(),
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
 * @param {string} notes The notes to use for the metadata.
 * @return {UavImageMetadata} The random `ImageMetadata` that it created.
 */
export function fakeImageMetadata(notes?: string): UavImageMetadata {
  return {
    name: faker.system.fileName(),
    format: faker.random.arrayElement([
      ImageFormat.GIF,
      ImageFormat.TIFF,
      ImageFormat.JPEG,
      ImageFormat.BMP,
      ImageFormat.PNG,
    ]),
    platformType: faker.random.arrayElement([
      PlatformType.GROUND,
      PlatformType.AERIAL,
    ]),
    notes: notes ?? faker.lorem.words(),
    sessionName: faker.lorem.words(),
    sequenceNumber: faker.datatype.number(),
    captureDate: faker.date.past().toISOString(),
    camera: faker.lorem.word(),
    location: {
      latitudeDeg: +faker.address.latitude(),
      longitudeDeg: +faker.address.longitude(),
    },
    locationDescription: faker.lorem.words(),
    altitudeMeters: faker.datatype.number(400),
    gsdCmPx: faker.datatype.number(2.0),
  };
}

/**
 * @return {Ordering} A fake `Ordering` that it created.
 */
export function fakeOrdering(): Ordering {
  return {
    field: faker.random.arrayElement([
      Field.NAME,
      Field.CAPTURE_DATE,
      Field.CAMERA,
      Field.SEQUENCE_NUM,
      Field.SESSION_NUM,
    ]),
    ascending: faker.datatype.boolean(),
  };
}

/**
 * @return {ImageQuery} A fake `ImageQuery` that it created.
 */
export function fakeImageQuery(): ImageQuery {
  return {
    name: faker.datatype.boolean() ? faker.lorem.words() : undefined,
    notes: faker.datatype.boolean() ? faker.lorem.sentence() : undefined,
    camera: faker.datatype.boolean() ? faker.lorem.words() : undefined,
  };
}

/**
 * @return {Suggestions} Fake autocomplete suggestions.
 */
export function fakeSuggestions(): Suggestions {
  return {
    menu: faker.random.arrayElement([
      AutocompleteMenu.NONE,
      AutocompleteMenu.DATE,
    ]),
    textCompletions: [faker.lorem.words(), faker.lorem.words()],
  };
}
