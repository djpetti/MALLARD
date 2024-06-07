import {
  ConnectedMetadataEditingForm,
  ConnectedMetadataForm,
  FormState,
  MetadataForm,
} from "../metadata-form";
import {
  fakeArtifactEntities,
  fakeEditableMetadata,
  fakeImageMetadata,
  fakeState,
  getShadowRoot,
} from "./element-test-utils";
import each from "jest-each";
import { PlatformType } from "mallard-api";
import {
  EditableMetadata,
  filterOnlyEditable,
  MetadataInferenceStatus,
  RootState,
} from "../types";
import { Action } from "redux";
import { faker } from "@faker-js/faker";

// Using older require syntax here so we get the correct mock type.
const uploadSlice = require("../upload-slice");
const mockSetMetadata = uploadSlice.setMetadata;

jest.mock("@captaincodeman/redux-connect-element", () => ({
  // Turn connect() into a pass-through.
  connect: jest.fn((_, elementClass) => elementClass),
}));
jest.mock("../upload-slice", () => ({
  setMetadata: jest.fn(),
}));
jest.mock("../store", () => ({
  // Mock this to avoid an annoying spurious console error from Redux.
  configureStore: jest.fn(),
}));

describe("metadata-form", () => {
  beforeEach(() => {
    // Set a faker seed.
    faker.seed(1337);
  });

  /**
   * Convenience function to extract the `#main` div from the generated HTML.
   * @param {string} tagName The tag name of the form element.
   * @return {HTMLElement} The main div element.
   */
  function getMainDivForTag(tagName: string): HTMLElement {
    const shadowRoot = getShadowRoot(tagName);
    return shadowRoot.querySelector("#main") as HTMLElement;
  }

  describe("metadata-form element", () => {
    /** Internal metadata-form to use for testing. */
    let metadataForm: ConnectedMetadataForm;

    beforeAll(() => {
      // Manually register the custom element.
      customElements.define(
        ConnectedMetadataForm.tagName,
        ConnectedMetadataForm
      );
    });

    beforeEach(() => {
      // Create the element under test.
      metadataForm = window.document.createElement(
        ConnectedMetadataForm.tagName
      ) as ConnectedMetadataForm;
      document.body.appendChild(metadataForm);
    });

    afterEach(() => {
      // Clean up the element we created.
      document.body
        .getElementsByTagName(ConnectedMetadataForm.tagName)[0]
        .remove();
    });

    /**
     * Convenience function to extract the `#main` div from the generated HTML.
     * @return {HTMLElement} The main div element.
     */
    function getMainDiv(): HTMLElement {
      return getMainDivForTag(metadataForm.tagName);
    }

    it("can be instantiated", () => {
      // Assert.
      expect(metadataForm.metadata).toBeNull();
      expect(metadataForm.state).toEqual(FormState.INACTIVE);
    });

    it("properly renders in the inactive state", async () => {
      // Act.
      metadataForm.state = FormState.INACTIVE;
      await metadataForm.updateComplete;

      // Assert.
      const mainDiv = getMainDiv();
      // The element should be invisible.
      expect(mainDiv.classList).toContain("hidden");
    });

    it("shows the loading indicator", async () => {
      // Act.
      metadataForm.state = FormState.LOADING;
      await metadataForm.updateComplete;

      // Assert.
      const mainDiv = getMainDiv();

      // The element should be visible.
      expect(mainDiv.classList).not.toContain("hidden");
      // The loading indicator should be visible.
      const loadingIndicator = mainDiv.querySelector(
        "#loading_indicator"
      ) as HTMLElement;
      expect(loadingIndicator.classList).not.toContain("hidden");
      // The form itself should not be visible.
      const form = mainDiv.querySelector("#form") as HTMLElement;
      expect(form.classList).toContain("hidden");
    });

    it("shows the form when it should", async () => {
      // Act.
      metadataForm.state = FormState.READY;
      await metadataForm.updateComplete;

      // Assert.
      const mainDiv = getMainDiv();

      // The element should be visible.
      expect(mainDiv.classList).not.toContain("hidden");
      // The loading indicator should be hidden.
      const loadingIndicator = mainDiv.querySelector(
        "#loading_indicator"
      ) as HTMLElement;
      expect(loadingIndicator.classList).toContain("hidden");
      // The form itself should be visible.
      const form = mainDiv.querySelector("#form") as HTMLElement;
      expect(form.classList).not.toContain("hidden");
    });

    it("correctly parses capture dates", async () => {
      // Arrange.
      // Set the capture date in the metadata.
      const metadata = fakeEditableMetadata();
      const captureDate = faker.date.past();
      metadata.captureDate = captureDate.toISOString();

      // Act.
      metadataForm.state = FormState.READY;
      metadataForm.metadata = metadata;
      await metadataForm.updateComplete;

      // Assert.
      // It should have set the correct value in the date field.
      const mainDiv = getMainDiv();
      const dateField = mainDiv.querySelector(
        "#capture_date"
      ) as HTMLInputElement;
      // Value of the date field should be the date in ISO format without the time component.
      const displayedDate = new Date(Date.parse(dateField.value));
      expect(captureDate.getUTCFullYear()).toEqual(
        displayedDate.getUTCFullYear()
      );
      expect(captureDate.getUTCMonth()).toEqual(displayedDate.getUTCMonth());
      expect(captureDate.getUTCDate()).toEqual(displayedDate.getUTCDate());
    });

    it("handles a case with a missing capture date", async () => {
      // Arrange.
      // Set the capture date in the metadata.
      const metadata = fakeEditableMetadata();
      // Make it look like the date is missing.
      metadata.captureDate = null;

      // Act.
      metadataForm.state = FormState.READY;
      metadataForm.metadata = metadata;
      await metadataForm.updateComplete;

      // Assert.
      // It should have set a current date value in the field.
      const mainDiv = getMainDiv();
      const dateField = mainDiv.querySelector(
        "#capture_date"
      ) as HTMLInputElement;
      // Value of the date field should be the date in ISO format without the time component.
      const displayedDate = new Date(Date.parse(dateField.value));
      const currentDate = new Date();
      expect(currentDate.getUTCFullYear()).toEqual(
        displayedDate.getUTCFullYear()
      );
      expect(currentDate.getUTCMonth()).toEqual(displayedDate.getUTCMonth());

      // It should have updated the internal metadata too.
      expect(metadataForm.metadata.captureDate).toEqual(dateField.value);
    });

    each([
      ["ground", PlatformType.GROUND],
      ["aerial", PlatformType.AERIAL],
    ]).it(
      "renders portions of the form specific to the %s platform",
      async (_: string, platform: PlatformType) => {
        // Arrange.
        // Generate metadata with the correct platform type.
        const metadata = fakeEditableMetadata();
        metadata.platformType = platform;

        // Act.
        metadataForm.metadata = metadata;
        metadataForm.state = FormState.READY;
        await metadataForm.updateComplete;

        // Assert.
        const mainDiv = getMainDiv();

        if (platform == PlatformType.AERIAL) {
          // It should have rendered air-specific fields.
          expect(mainDiv.querySelector("#altitude")).not.toBeNull();
          expect(mainDiv.querySelector("#gsd")).not.toBeNull();
        } else if (platform == PlatformType.GROUND) {
          // It should not have rendered air-specific fields.
          expect(mainDiv.querySelector("#altitude")).toBeNull();
          expect(mainDiv.querySelector("#gsd")).toBeNull();
        }
      }
    );

    each([
      ["Session Name", "session_name", "sessionName", faker.lorem.word()],
      [
        "Capture Date",
        "capture_date",
        "captureDate",
        faker.date.past().toISOString(),
      ],
      ["Camera", "camera", "camera", faker.lorem.word()],
      ["Notes", "notes", "notes", faker.lorem.word()],
    ]).it(
      "handles a change to the %s field",
      async (
        _: string,
        id: string,
        metadataProperty: keyof EditableMetadata,
        fakeValue: string
      ) => {
        // Arrange.
        // Set some initial metadata to be updated.
        metadataForm.metadata = fakeEditableMetadata();

        // Act.
        // Dispatch a fake change event on a text field.
        const mainDiv = getMainDiv();
        const textField = mainDiv.querySelector(`#${id}`) as HTMLInputElement;

        // Set some fake input.
        textField.value = fakeValue;

        textField.dispatchEvent(new Event("change"));

        await metadataForm.updateComplete;

        // Assert.
        // It should have updated the internal metadata.
        expect(metadataForm.metadata[metadataProperty]).toEqual(fakeValue);
      }
    );

    each([
      ["Altitude", "altitude", "altitudeMeters"],
      ["GSD", "gsd", "gsdCmPx"],
    ]).it(
      "handles a change to the %s numerical field",
      async (
        _: string,
        id: string,
        metadataProperty: keyof EditableMetadata
      ) => {
        // Arrange.
        // Set some initial metadata to be updated.
        const metadata = fakeEditableMetadata();
        // Make sure to set the aerial platform type so it shows the field we're looking for.
        metadata.platformType = PlatformType.AERIAL;
        metadataForm.metadata = metadata;

        // Wait for it to re-render with air-specific form.
        await metadataForm.updateComplete;

        // Act.
        // Dispatch a fake change event on a numerical field.
        const mainDiv = getMainDiv();
        const numericalField = mainDiv.querySelector(
          `#${id}`
        ) as HTMLInputElement;

        // Set some fake input.
        const numberInput = faker.datatype.number();
        numericalField.value = numberInput.toString();

        numericalField.dispatchEvent(new Event("change"));

        await metadataForm.updateComplete;

        // Assert.
        // It should have updated the internal metadata.
        expect(metadataForm.metadata[metadataProperty]).toEqual(numberInput);
      }
    );

    it("handles a change to a radio field", async () => {
      // Arrange.
      // Set some initial metadata to be updated.
      const metadata = fakeEditableMetadata();
      metadata.platformType = PlatformType.GROUND;
      metadataForm.metadata = metadata;

      // Act.
      // Dispatch a fake change event on a radio field.
      const mainDiv = getMainDiv();
      const radioField = mainDiv.querySelector(
        "#platform_radio_uav"
      ) as HTMLInputElement;

      // Make it look like the radio selection was switched.
      radioField.dispatchEvent(new Event("change"));

      await metadataForm.updateComplete;

      // Assert.
      // It should have updated the internal metadata.
      expect(metadataForm.metadata.platformType).toEqual(PlatformType.AERIAL);
    });

    each([
      ["no user modifications", false, true],
      ["user modifications", true, true],
      ["user modifications and the dialog closed", true, false],
    ]).it(
      "updates the properties from the Redux state with %s",
      (_: string, userModified: boolean, dialogOpen: boolean) => {
        // Arrange.
        // Set some initial metadata.
        const oldMetadata = fakeEditableMetadata();
        metadataForm.metadata = oldMetadata;

        if (userModified) {
          // To simulate data being modified by the user, dispatch a change event on the form.
          const mainDiv = getMainDiv();
          const field = mainDiv.querySelector(
            "#session_name"
          ) as HTMLInputElement;
          field.value = oldMetadata.sessionName ?? "";
          field.dispatchEvent(new Event("change"));
        }

        // Create a fake state.
        const state: RootState = fakeState();

        // Set the relevant parameters.
        state.uploads.metadata = fakeEditableMetadata();
        state.uploads.metadataStatus = faker.helpers.arrayElement([
          MetadataInferenceStatus.NOT_STARTED,
          MetadataInferenceStatus.LOADING,
          MetadataInferenceStatus.COMPLETE,
        ]);
        state.uploads.dialogOpen = dialogOpen;

        // Act.
        const updates = metadataForm.mapState(state);

        // Assert.
        if (userModified) {
          // In this case, the metadata should not have been updated.
          expect(updates.metadata).toEqual(oldMetadata);
        } else {
          // The metadata should have been set from the state.
          expect(updates.metadata).toEqual(state.uploads.metadata);
        }

        // The element state should have been set.
        expect(updates.state).toEqual(state.uploads.metadataStatus);

        if (dialogOpen) {
          expect(updates.userModified).toEqual(userModified);
        } else {
          // It should not track user updates when the dialog is closed.
          expect(updates.userModified).toEqual(false);
        }
      }
    );

    describe("maps the correct actions to events", () => {
      /** Map of events to action creators. */
      let eventMap: { [p: string]: (event: Event) => Action };

      beforeEach(() => {
        // Act.
        eventMap = metadataForm.mapEvents();

        // Assert.
        // It should have a mapping for the proper events.
        expect(eventMap).toHaveProperty(MetadataForm.FORM_CHANGED_EVENT_NAME);
      });

      it("uses the correct action creator for form change events", () => {
        // Arrange.
        const testEvent = {
          type: MetadataForm.FORM_CHANGED_EVENT_NAME,
          detail: fakeImageMetadata(),
        };

        // Act.
        eventMap[MetadataForm.FORM_CHANGED_EVENT_NAME](
          testEvent as unknown as Event
        );

        // Assert.
        expect(mockSetMetadata).toBeCalledWith(testEvent.detail);
      });
    });
  });

  describe("metadata-editing-form", () => {
    /** Internal metadata-editing-form to use for testing. */
    let metadataForm: ConnectedMetadataEditingForm;

    beforeAll(() => {
      // Manually register the custom element.
      customElements.define(
        ConnectedMetadataEditingForm.tagName,
        ConnectedMetadataEditingForm
      );
    });

    beforeEach(() => {
      // Create the element under test.
      metadataForm = window.document.createElement(
        ConnectedMetadataEditingForm.tagName
      ) as ConnectedMetadataEditingForm;
      document.body.appendChild(metadataForm);
    });

    afterEach(() => {
      // Clean up the element we created.
      document.body
        .getElementsByTagName(ConnectedMetadataEditingForm.tagName)[0]
        .remove();
    });

    /**
     * Convenience function to extract the `#main` div from the generated HTML.
     * @return {HTMLElement} The main div element.
     */
    function getMainDiv(): HTMLElement {
      return getMainDivForTag(metadataForm.tagName);
    }

    each([
      ["no user modifications", false, true],
      ["user modifications", true, true],
      ["user modifications and the dialog closed", true, false],
    ]).it(
      "updates the properties from the Redux state with %s",
      (_: string, userModified: boolean, dialogOpen: boolean) => {
        // Arrange.
        // Set some initial metadata.
        const oldMetadata = fakeEditableMetadata();
        metadataForm.metadata = oldMetadata;

        if (userModified) {
          // To simulate data being modified by the user, dispatch a change event on the form.
          const mainDiv = getMainDiv();
          const field = mainDiv.querySelector(
            "#session_name"
          ) as HTMLInputElement;
          field.value = oldMetadata.sessionName ?? "";
          field.dispatchEvent(new Event("change"));
        }

        // Make it look like we have some selected images.
        const imageEntities = fakeArtifactEntities(3);
        const seletedIds = imageEntities.ids.slice(0, 2);
        for (const id of imageEntities.ids) {
          imageEntities.entities[id].isSelected = false;
        }
        for (const id of seletedIds) {
          imageEntities.entities[id].isSelected = true;
        }

        // Create a fake state.
        const state: RootState = fakeState();
        state.imageView.ids = imageEntities.ids;
        state.imageView.entities = imageEntities.entities;
        state.imageView.editingDialogOpen = dialogOpen;

        // Act.
        const updates = metadataForm.mapState(state);

        // Assert.
        if (userModified) {
          // In this case, the metadata should not have been updated.
          expect(updates.metadata).toEqual(oldMetadata);
        } else {
          // The metadata should have been set from the selected images.
          const setEntity = state.imageView.entities[seletedIds[0]];
          expect(updates.metadata).toEqual(
            setEntity?.metadata ? filterOnlyEditable(setEntity.metadata) : null
          );
        }

        // The element state should always be ready.
        expect(updates.state).toEqual(FormState.READY);

        if (dialogOpen) {
          expect(updates.userModified).toEqual(userModified);
        } else {
          // It should not track user updates when the dialog is closed.
          expect(updates.userModified).toEqual(false);
        }
      }
    );
  });
});
