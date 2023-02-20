import { queriesFromSearchString, requestAutocomplete } from "../autocomplete";
import { queryImages, getMetadata } from "../api-client";
import each from "jest-each";
import { fakeImageMetadata, fakeObjectRef } from "./element-test-utils";

const faker = require("faker");

jest.mock("../api-client", () => ({
  queryImages: jest.fn(),
  getMetadata: jest.fn(),
}));
const mockQueryImages = queryImages as jest.MockedFn<typeof queryImages>;
const mockGetMetadata = getMetadata as jest.MockedFn<typeof getMetadata>;

describe("autocomplete", () => {
  beforeEach(() => {
    // Set the faker seed.
    faker.seed(1337);
  });

  it("can generate queries from a search string", () => {
    // Arrange.
    // Create a fake search string.
    const searchString = faker.lorem.sentence();

    // Act.
    const queries = queriesFromSearchString(searchString);

    // Assert.
    // It should have searched the text fields.
    expect(queries).toContainEqual({ name: searchString });
    expect(queries).toContainEqual({ notes: searchString });
    expect(queries).toContainEqual({ camera: searchString });
  });

  each([
    ["is an exact match", "some notes", "some notes", "some notes"],
    ["is contained", "prefix notes suffix", "notes", "prefix notes suffix"],
    [
      "is the maximum length",
      "foo bar baz foo bar",
      "baz",
      "foo bar baz foo bar",
    ],
    [
      "matches the end",
      "this string matches at the end",
      "end",
      "...g matches at the end",
    ],
    [
      "is very long",
      "field for search that exceeds the maximum length",
      "search that exceeds the maximum length",
      "...search that exceeds the maximum length",
    ],
    [
      "a real-life example (1)",
      "Switchgrass data collected from Dr. Devos",
      "switchgrass data",
      "Switchgrass data col...",
    ],
  ]).it(
    "gets autocomplete suggestions when the search string %s",
    async (_, fieldValue: string, searchString: string, suggestion: string) => {
      // Arrange.
      // Make it look like the initial queries succeeded.
      const queryResults = [fakeObjectRef()];
      mockQueryImages.mockResolvedValue({
        imageIds: queryResults,
        pageNum: 1,
        isLastPage: true,
      });

      // Make it look like getting the metadata succeeded.
      const metadata = fakeImageMetadata(fieldValue);
      mockGetMetadata.mockResolvedValue(metadata);

      // Act.
      const suggestions = await requestAutocomplete(searchString, 5, 20);

      // Assert.
      // Since we only mocked a single result, we should get a single
      // suggestion.
      expect(suggestions).toHaveLength(1);
      expect(suggestions[0]).toEqual(suggestion);
    }
  );
});
