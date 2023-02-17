import { ImageQuery } from "./types";
import { getMetadata, queryImages } from "./api-client";
import { UavImageMetadata } from "typescript-axios";

/** Maximum length we allow for autocomplete suggestions. */
const MAX_AUTOCOMPLETE_LENGTH = 60;

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
  desiredLength: number = MAX_AUTOCOMPLETE_LENGTH
): string | null {
  // Ignore case
  searchString = searchString.toLowerCase();
  const fieldTextLower = fieldText.toLowerCase();

  let startIndex = fieldTextLower.indexOf(searchString);
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
  if (endIndex < fieldText.length) {
    suffix = "...";
  }
  startIndex = Math.max(startIndex, 0);
  endIndex = Math.min(endIndex, fieldText.length);

  // If we still have some more length to fill, try expanding.
  let lengthBudget = desiredLength - (endIndex - startIndex);
  if (lengthBudget > 0) {
    startIndex = Math.max(startIndex - lengthBudget, 0);
    lengthBudget = endIndex - startIndex - desiredLength;
  }
  if (lengthBudget > 0) {
    endIndex = Math.min(endIndex + lengthBudget, fieldText.length);
  }

  // Extract the surrounding text.
  return prefix + fieldText.substring(startIndex, endIndex) + suffix;
}

/**
 * Finds the text that surrounds the search string in an autocomplete
 * suggestion.
 * @param {string} searchString The original search string.
 * @param {UavImageMetadata} metadata The metadata for a matching entity.
 * @param {number} desiredLength THe desired length of the returned text.
 * @return {string} The surrounding text from the field that matches.
 */
function findSurroundingText(
  searchString: string,
  metadata: UavImageMetadata,
  desiredLength: number = MAX_AUTOCOMPLETE_LENGTH
): string {
  // Check the text fields for matches.
  let matchText: string | null = null;

  const searchField = (fieldText?: string) =>
    findTextInField(searchString, fieldText ?? "", desiredLength) ?? matchText;

  matchText = searchField(metadata.name);
  matchText = searchField(metadata.notes);
  matchText = searchField(metadata.camera);

  return matchText as string;
}

/**
 * Removes duplicate auto-complete suggestions.
 * @param {string[]} suggestions The raw suggestions.
 * @return {string[]} The filtered suggestions.
 */
function deDuplicateSuggestions(suggestions: string[]): string[] {
  const suggestionSet = new Set<string>();

  const filteredSuggestions = [];
  for (const suggestion of suggestions) {
    if (!suggestionSet.has(suggestion)) {
      filteredSuggestions.push(suggestion);
      suggestionSet.add(suggestion);
    }
  }

  return filteredSuggestions;
}

/**
 * Generates a set of queries based on the search string a user entered.
 * @param {string} searchString The search string.
 * @return {ImageQuery[]} The generated query.
 */
export function queriesFromSearchString(searchString: string): ImageQuery[] {
  // We will look for the input in all the text fields at once.
  return [
    { name: searchString },
    { notes: searchString },
    { camera: searchString },
  ];
}

/**
 * Performs a request to auto-complete a search string.
 * @param {string} searchString The search string to get suggested
 *  completions for.
 * @param {number} numSuggestions The maximum number of autocomplete suggestions
 *  to get.
 * @param {number} desiredLength The desired length of the suggestions.
 * @return {string[]} The autocomplete suggestions.
 */
export async function requestAutocomplete(
  searchString: string,
  numSuggestions: number = 5,
  desiredLength: number = MAX_AUTOCOMPLETE_LENGTH
): Promise<string[]> {
  // Initially, query for any entities that match the search string.
  const queries = queriesFromSearchString(searchString);
  const matchedEntities = await queryImages(queries, [], numSuggestions);

  // Get the metadata for all the matched entities.
  const allMetadata = await Promise.all(
    matchedEntities.imageIds.map((i) => getMetadata(i))
  );

  // Find the matching text from each item.
  const suggestions = allMetadata.map((m) =>
    findSurroundingText(searchString, m, desiredLength)
  );
  return deDuplicateSuggestions(suggestions);
}
