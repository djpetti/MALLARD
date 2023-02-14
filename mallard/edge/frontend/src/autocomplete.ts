import { ImageQuery } from "./types";
import { getMetadata, queryImages } from "./api-client";
import { UavImageMetadata } from "typescript-axios";

/**
 * Generates a set of queries based on the search string a user entered.
 * @param {string} searchString The search string.
 * @return {ImageQuery[]} The generated query.
 */
function queriesFromSearchString(searchString: string): ImageQuery[] {
  // We will look for the input in all the text fields at once.
  return [
    { name: searchString },
    { notes: searchString },
    { camera: searchString },
  ];
}

/**
 * Finds the text that surrounds the search string in an autocomplete
 * suggestion.
 * @param {string} searchString The original search string.
 * @param {UavImageMetadata} metadata The metadata for a matching entity.
 */
function findSurroundingText(
  searchString: string,
  metadata: UavImageMetadata
): string {
  // Check the text fields for matches.
  let matchText: string;
}

/**
 * Performs a request to auto-complete a search string.
 * @param {string} searchString The search string to get suggested
 *  completions for.
 * @param {number} numSuggestions The maximum number of autocomplete suggestions
 *  to get.
 * @return {string[]} The autocomplete suggestions.
 */
export async function requestAutocomplete(
  searchString: string,
  numSuggestions: number = 5
): Promise<string[]> {
  // Initially, query for any entities that match the search string.
  const queries = queriesFromSearchString(searchString);
  const matchedEntities = await queryImages(queries, [], numSuggestions);

  // Get the metadata for all the matched entities.
  const metadata = Promise.all(
    matchedEntities.imageIds.map((i) => getMetadata(i))
  );
}
