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
 * Finds text that matches a search string in the contents of a field. It
 * will extract the surrounding text.
 * @param {string} searchString The string to search for.
 * @param {string} fieldText The field text to search in.
 * @param {number} desiredLength The desired length of the returned text.
 *  This will control how much of the surrounding text it extracts.
 * @return {string|null} The surrounding text, or null if the text was not
 *  found.
 */
function findTextInField(
  searchString: string,
  fieldText: string,
  desiredLength: number = 30
): string | null {
  let startIndex = fieldText.indexOf(searchString);
  if (startIndex < 0) {
    // Search string was not found.
    return null;
  }

  // Expand the boundaries of the substring to include some additional text.
  const expandBy = Math.floor(
    Math.max(desiredLength - searchString.length, 0) / 2
  );
  let endIndex = startIndex + searchString.length + expandBy;
  startIndex -= expandBy;

  // Add ellipses to indicate to the user that some text is not shown.
  let prefix = "";
  let suffix = "";
  if (startIndex > 0) {
    prefix = "...";
  }
  if (endIndex >= fieldText.length) {
    suffix = "...";
  }
  startIndex = Math.max(startIndex, 0);
  endIndex = Math.min(endIndex, fieldText.length - 1);

  // Extract the surrounding text.
  return prefix + fieldText.substring(startIndex, endIndex) + suffix;
}

/**
 * Finds the text that surrounds the search string in an autocomplete
 * suggestion.
 * @param {string} searchString The original search string.
 * @param {UavImageMetadata} metadata The metadata for a matching entity.
 * @return {string} The surrounding text from the field that matches.
 */
function findSurroundingText(
  searchString: string,
  metadata: UavImageMetadata
): string {
  // Check the text fields for matches.
  let matchText: string | null = null;

  matchText = findTextInField(searchString, metadata.name ?? "") ?? matchText;
  matchText = findTextInField(searchString, metadata.notes ?? "") ?? matchText;
  matchText = findTextInField(searchString, metadata.camera ?? "") ?? matchText;

  return matchText as string;
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
  const allMetadata = await Promise.all(
    matchedEntities.imageIds.map((i) => getMetadata(i))
  );

  // Find the matching text from each item.
  return allMetadata.map((m) => findSurroundingText(searchString, m));
}
