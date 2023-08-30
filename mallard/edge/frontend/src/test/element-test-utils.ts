/**
 * Common utilities for testing Lit elements.
 */

import {
  FileStatus,
  FrontendFileEntity,
  ArtifactEntity,
  ImageQuery,
  ArtifactStatus,
  MetadataInferenceStatus,
  RequestState,
  RootState,
  UploadWorkflowStatus,
} from "../types";
import { faker } from "@faker-js/faker";
import {
  Field,
  ImageFormat,
  ObjectRef,
  ObjectType,
  Ordering,
  PlatformType,
  TypedObjectRef,
  UavImageMetadata,
  UavVideoMetadata,
  VideoFormat,
} from "mallard-api";
import { AutocompleteMenu, Suggestions } from "../autocomplete";
import { EntityId } from "@reduxjs/toolkit";
import { createArtifactEntityId } from "../thumbnail-grid-slice";

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
      imageDeletionState: RequestState.IDLE,
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
      details: { frontendId: null },
      numItemsSelected: 0,
      numThumbnailsLoaded: 0,
      bulkDownloadState: RequestState.IDLE,
      metadataEditingState: RequestState.IDLE,
      exportedImagesUrl: null,

      collapsedSections: {},

      editingDialogOpen: false,
    },
    uploads: {
      dialogOpen: false,
      isDragging: false,
      uploadsInProgress: 0,
      uploadsCompleted: 0,

      ids: [],
      entities: {},

      metadataStatus: MetadataInferenceStatus.NOT_STARTED,
      metadata: null,
      metadataChanged: false,

      status: UploadWorkflowStatus.WAITING,
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
 * @param {ObjectType} type Specify a specific type for this entity.
 * @return {ArtifactEntity} The entity that it created.
 */
export function fakeArtifactEntity(
  thumbnailLoaded?: boolean,
  imageLoaded?: boolean,
  captureDate?: Date,
  sessionName?: string,
  type?: ObjectType
): ArtifactEntity {
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

  const backendId = fakeTypedObjectRef(type);
  let thumbnailStatus: ArtifactStatus = ArtifactStatus.NOT_LOADED;
  let imageStatus: ArtifactStatus = ArtifactStatus.NOT_LOADED;
  let metadataStatus: ArtifactStatus = ArtifactStatus.NOT_LOADED;
  let thumbnailUrl: string | null = null;
  let imageUrl: string | null = null;
  let previewUrl: string | null = null;
  let streamableUrl: string | null = null;
  const metadata = fakeRasterMetadata();
  metadata.captureDate = captureDate.toISOString();
  metadata.sessionName = sessionName;
  if (thumbnailLoaded) {
    // Simulate a loaded thumbnail.
    thumbnailStatus = ArtifactStatus.LOADED;
    thumbnailUrl = faker.image.dataUri();
  }
  if (imageLoaded) {
    // Simulate a loaded image.
    imageStatus = ArtifactStatus.LOADED;
    metadataStatus = ArtifactStatus.LOADED;
    imageUrl = faker.image.dataUri();
  }

  if (backendId.type === ObjectType.VIDEO) {
    previewUrl = faker.internet.url();
    streamableUrl = faker.internet.url();
  }

  return {
    backendId: backendId,
    thumbnailStatus: thumbnailStatus,
    imageStatus: imageStatus,
    metadataStatus: metadataStatus,
    thumbnailUrl: thumbnailUrl,
    artifactUrl: imageUrl,
    previewUrl: previewUrl,
    streamableUrl: streamableUrl,
    metadata: metadata,
    isSelected: faker.datatype.boolean(),
  };
}

/**
 * Contains image entities, and corresponding frontend IDs.
 */
export interface EntitiesAndIds {
  ids: EntityId[];
  entities: { [id: EntityId]: ArtifactEntity };
}

/**
 * @brief Creates a full set of ArtifactEntities to use for a test.
 * Note that this
 *  uses `createImageEntityId` internally, so it should not be mocked.
 * @param {number?} numEntities The number of fake entities to add. If not
 *  provided it will choose randomly.
 * @param {any} entityArgs Will be forwarded to `fakeImageEntity`.
 * @return {EntitiesAndIds} The fake entities that it created.
 */
export function fakeArtifactEntities(
  numEntities?: number,
  ...entityArgs: any
): EntitiesAndIds {
  if (numEntities === undefined) {
    // Choose the number of entities randomly.
    numEntities = faker.datatype.number(15);
  }

  const state: EntitiesAndIds = { ids: [], entities: {} };
  for (let i = 0; i < numEntities; ++i) {
    const entity = fakeArtifactEntity(...entityArgs);
    const frontendId = createArtifactEntityId(entity.backendId.id);

    state.ids.push(frontendId);
    state.entities[frontendId] = entity;
  }

  return state;
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
    status = faker.helpers.arrayElement([
      FileStatus.PENDING,
      FileStatus.UPLOADING,
      FileStatus.COMPLETE,
    ]);
  }

  return {
    id: id,
    thumbnailUrl: iconUrl,
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
 * Creates a fake `TypedObjectRef`.
 * @return {TypedObjectRef} The random `TypedObjectRef` that it created.
 * @param {ObjectType} type If specified, use this specific type for the object.
 */
export function fakeTypedObjectRef(type?: ObjectType): TypedObjectRef {
  if (type === undefined) {
    type = faker.helpers.arrayElement([ObjectType.IMAGE, ObjectType.VIDEO]);
  }
  return {
    type: type,
    id: fakeObjectRef(),
  };
}

/**
 * Creates common parameters for `UavImageMetadata` and `UavVideoMetadata`.
 * @param {string} notes The notes to use for the metadata.
 * @return {UavImageMetadata | UavVideoMetadata} The metadata it created.
 */
function fakeRasterMetadata(
  notes?: string
): UavImageMetadata | UavVideoMetadata {
  return {
    size: faker.datatype.number({ min: 0 }),
    name: faker.system.fileName(),
    platformType: faker.helpers.arrayElement([
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
 * Creates a fake `UavImageMetadata`.
 * @param {string} notes The notes to use for the metadata.
 * @return {UavImageMetadata} The random `ImageMetadata` that it created.
 */
export function fakeImageMetadata(notes?: string): UavImageMetadata {
  const metadata = fakeRasterMetadata(notes) as UavImageMetadata;

  metadata.format = faker.helpers.arrayElement([
    ImageFormat.GIF,
    ImageFormat.TIFF,
    ImageFormat.JPEG,
    ImageFormat.BMP,
    ImageFormat.PNG,
  ]);
  return metadata;
}

/**
 * Creates a fake `UavVideoMetadata`.
 * @param {string} notes The notes to use for the metadata.
 * @return {UavVideoMetadata} The random `ImageMetadata` that it created.
 */
export function fakeVideoMetadata(notes?: string): UavVideoMetadata {
  const metadata = fakeRasterMetadata(notes) as UavVideoMetadata;

  metadata.format = faker.helpers.arrayElement([
    VideoFormat.AV1,
    VideoFormat.VP8,
    VideoFormat.VP9,
    VideoFormat.AVC,
    VideoFormat.H263,
    VideoFormat.HEVC,
    VideoFormat.THEORA,
  ]);
  return metadata;
}

/**
 * @return {Ordering} A fake `Ordering` that it created.
 */
export function fakeOrdering(): Ordering {
  return {
    field: faker.helpers.arrayElement([
      Field.NAME,
      Field.CAPTURE_DATE,
      Field.CAMERA,
      Field.SEQUENCE_NUM,
      Field.SESSION,
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
    menu: faker.helpers.arrayElement([
      AutocompleteMenu.NONE,
      AutocompleteMenu.DATE,
    ]),
    textCompletions: [faker.lorem.words(), faker.lorem.words()],
  };
}

/**
 * @param {string} mimeType The MIME type to use for the fake file.
 * @return {File} A fake `File` that appears to contain image data.
 */
export function fakeFile(mimeType: string = "image/jpeg"): File {
  return new File([faker.datatype.string()], faker.system.fileName(), {
    type: mimeType,
  });
}
