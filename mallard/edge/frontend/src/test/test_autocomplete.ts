import {
  AutocompleteMenu,
  completeSearch,
  completeToken,
  queriesFromSearchString,
  requestAutocomplete,
  updateMenu,
} from "../autocomplete";
import { queryImages, getMetadata } from "../api-client";
import each from "jest-each";
import { fakeImageMetadata, fakeTypedObjectRef } from "./element-test-utils";
import { ImageQuery } from "../types";
import { PlatformType } from "mallard-api";
import { faker } from "@faker-js/faker";

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

  each([
    ["empty", "", [{}]],
    [
      "natural language",
      "this is a string",
      [
        { name: "this is a string" },
        { notes: "this is a string" },
        { camera: "this is a string" },
        { session: "this is a string" },
      ],
    ],
    [
      "date (before)",
      "before:2023-02-24",
      [{ captureDates: { maxValue: "2023-02-24" } }],
    ],
    [
      "date (after)",
      "after:1997-07-25",
      [{ captureDates: { minValue: "1997-07-25" } }],
    ],
    [
      "date range",
      "after:2022-01-01 before:2022-12-31",
      [{ captureDates: { minValue: "2022-01-01", maxValue: "2022-12-31" } }],
    ],
    [
      "date (date)",
      "date:2023-02-24",
      [{ captureDates: { minValue: "2023-02-24", maxValue: "2023-02-24" } }],
    ],
    [
      "date (on)",
      "on:2023-02-24",
      [{ captureDates: { minValue: "2023-02-24", maxValue: "2023-02-24" } }],
    ],
    ["platform", "platform:ground", [{ platformType: PlatformType.GROUND }]],
    [
      "platform + date",
      "platform:aerial date:2023-03-02",
      [
        {
          platformType: PlatformType.AERIAL,
          captureDates: { minValue: "2023-03-02", maxValue: "2023-03-02" },
        },
      ],
    ],
    [
      "date + natural language",
      "on:2023-02-24 search string",
      [
        {
          captureDates: { minValue: "2023-02-24", maxValue: "2023-02-24" },
          name: "search string",
        },
        {
          captureDates: { minValue: "2023-02-24", maxValue: "2023-02-24" },
          notes: "search string",
        },
        {
          captureDates: { minValue: "2023-02-24", maxValue: "2023-02-24" },
          camera: "search string",
        },
        {
          captureDates: { minValue: "2023-02-24", maxValue: "2023-02-24" },
          session: "search string",
        },
      ],
    ],
    [
      "date + natural language (reversed)",
      "search string on:2023-02-24",
      [
        {
          captureDates: { minValue: "2023-02-24", maxValue: "2023-02-24" },
          name: "search string",
        },
        {
          captureDates: { minValue: "2023-02-24", maxValue: "2023-02-24" },
          notes: "search string",
        },
        {
          captureDates: { minValue: "2023-02-24", maxValue: "2023-02-24" },
          camera: "search string",
        },
        {
          captureDates: { minValue: "2023-02-24", maxValue: "2023-02-24" },
          session: "search string",
        },
      ],
    ],
    [
      "invalid directive",
      "foo:bar search string",
      [
        // It should just ignore the invalid token.
        { name: "search string" },
        { notes: "search string" },
        { camera: "search string" },
        { session: "search string" },
      ],
    ],
    [
      "invalid date",
      "date:invalid",
      [
        // It should just ignore the invalid date.
        {},
      ],
    ],
    ["invalid platform", "platform:invalid", [{}]],
  ]).it(
    "can generate queries from a %s search",
    (_: string, searchString: string, expectedQueries: ImageQuery[]) => {
      // Act.
      const queries = queriesFromSearchString(searchString);

      // Assert.
      expect(queries).toHaveLength(expectedQueries.length);
      // The order of the queries doesn't matter.
      for (const query of expectedQueries) {
        expect(queries).toContainEqual(query);
      }
    }
  );

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
      "the end",
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
      const queryResults = [fakeTypedObjectRef()];
      mockQueryImages.mockResolvedValue({
        imageIds: queryResults,
        pageNum: 1,
        isLastPage: true,
      });

      // Make it look like getting the metadata succeeded.
      const metadata = fakeImageMetadata(fieldValue);
      mockGetMetadata.mockResolvedValue([metadata]);

      // Act.
      const suggestions = await requestAutocomplete(searchString, 5, 20);

      // Assert.
      // Since we only mocked a single result, we should get a single
      // suggestion.
      expect(suggestions).toHaveLength(1);
      expect(suggestions[0]).toEqual(suggestion);
    }
  );

  each([
    ["is empty", "", AutocompleteMenu.NONE],
    ["matches before directive", "this befo", AutocompleteMenu.DATE],
    ["matches after directive", "aft", AutocompleteMenu.DATE],
    ["matches platform directive", "foo plat", AutocompleteMenu.PLATFORM],
    ["completely matches a directive", "date", AutocompleteMenu.DATE],
    ["has extra characters", "date:2023-02-", AutocompleteMenu.DATE],
    ["is too short", "be", AutocompleteMenu.NONE],
  ]).it(
    "gets correct autocomplete menu suggestions when the search string %s",
    (_, searchString: string, menu: AutocompleteMenu) => {
      // Act.
      const gotMenu = updateMenu(searchString);

      // Assert.
      expect(gotMenu).toEqual(menu);
    }
  );

  each([
    ["the search string is empty", "", "next", "next"],
    ["the token overlaps", "date", "date:2022-02-27", "date:2022-02-27"],
    [
      "the token does not overlap",
      "my favorite",
      "search",
      "my favorite search",
    ],
  ]).it(
    "can complete partial tokens when %s",
    (_, searchString: string, nextToken: string, completion: string) => {
      // Act.
      const gotCompletion = completeToken(searchString, nextToken);

      // Assert.
      expect(gotCompletion).toEqual(completion);
    }
  );

  each([
    ["the search string is empty", "", "next", "next"],
    [
      "the suggestion overlaps (1)",
      "search str",
      "search string here",
      "search string here",
    ],
    [
      "the suggestion overlaps (2)",
      "date:2022-03-01 sea",
      "search string",
      "date:2022-03-01 search string",
    ],
    [
      "the suggestion is a superstring",
      "date:2023-03-01 aerial",
      "m100 aerial data",
      "date:2023-03-01 m100 aerial data",
    ],
    [
      "the suggestion does not overlap",
      "my favorite",
      "search",
      "my favorite search",
    ],
    ["the cases don't match", "dan", "Daniel", "Daniel"],
    [
      "the search has a platform directive",
      "date:2023-03-02 platform:ground sea",
      "search string",
      "date:2023-03-02 platform:ground search string",
    ],
  ]).it(
    "can complete search strings when %s",
    (_, searchString: string, suggestion: string, completion: string) => {
      // Act.
      const gotCompletion = completeSearch(searchString, suggestion);

      // Assert.
      expect(gotCompletion).toEqual(completion);
    }
  );
});
