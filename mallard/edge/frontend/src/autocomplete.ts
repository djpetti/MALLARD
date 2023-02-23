import { ImageQuery } from "./types";
import { getMetadata, queryImages } from "./api-client";
import { RangeDate, UavImageMetadata } from "typescript-axios";

/** Maximum length we allow for autocomplete suggestions. */
const MAX_AUTOCOMPLETE_LENGTH = 60;

export enum AutocompleteMenu {
  /** No menu-based suggestions. */
  NONE,
  /** Show the date selector. */
  DATE,
}

export interface Suggestions {
  /** The menu-based suggestions. */
  menu: AutocompleteMenu;
  /** The text completion suggestions. */
  textCompletions: string;
}

/**
 * Represents a token.
 */
class Token {
  /** The value of the token. */
  readonly value: string;
  /** Whether this is the special end token. */
  readonly isEnd: boolean;

  /**
   * @param {string} value The value of the token. If not
   *  provided, it will be assumed to be the special end token.
   */
  constructor(value?: string) {
    this.value = value ?? "";
    this.isEnd = !!value;
  }
}

/** Represents a single parsed predicate from the search. */
abstract class Predicate {
  /**
   * Parses a token from the input, expanding the predicate.
   * @param {string} token The input token to parse.
   * @return {boolean} True if it succeeded in parsing the token, false if
   *  the input is invalid for this token type.
   */
  abstract parse(token: Token): boolean;

  /**
   * @return {boolean} True iff this predicate has been fully matched.
   */
  abstract isMatched(): boolean;

  /**
   * Creates the queries that corresponds to this predicate.
   * @return {ImageQuery[]} The corresponding queries.
   */
  abstract makeQueries(): ImageQuery[];
}

/** Predicate representing a natural-language search string. */
class StringPredicate extends Predicate {
  /** The search string. */
  searchString: string = "";

  /** Whether we saw the end of this natural-language search string. */
  reachedEnd: boolean = false;

  /**
   * @inheritDoc
   */
  override parse(token: Token): boolean {
    if (token.isEnd || token.value.includes(":")) {
      // This is actually a "special" token, not natural language.
      this.reachedEnd = true;
      return token.isEnd;
    }

    // Append the string to whatever we parsed already.
    this.searchString += token;
    return true;
  }

  /**
   * @inheritDoc
   */
  override isMatched(): boolean {
    return this.reachedEnd;
  }

  /**
   * @inheritDoc
   */
  override makeQueries(): ImageQuery[] {
    return [
      { name: this.searchString },
      { notes: this.searchString },
      { camera: this.searchString },
    ];
  }
}

/** The condition specified for the date predicate. */
enum DateCondition {
  /** We want results before this date. */
  BEFORE,
  /** We want results after this date. */
  AFTER,
  /** We want results from this exact date. */
  ON,
}

/** Predicate representing a boundary on the capture date. */
class CaptureDatePredicate extends Predicate {
  /** The condition specified by the user. */
  condition: DateCondition | null = null;
  /** The date specified. */
  date: Date | null = null;

  /**
   * @inheritDoc
   */
  override parse(token: Token): boolean {
    if (token.isEnd) {
      return true;
    }

    if (token.value.startsWith("before:")) {
      this.condition = DateCondition.BEFORE;
    } else if (token.value.startsWith("after:")) {
      this.condition = DateCondition.AFTER;
    } else if (
      token.value.startsWith("on:") ||
      token.value.startsWith("date:")
    ) {
      this.condition = DateCondition.ON;
    } else {
      // It doesn't match at all.
      return false;
    }

    // Parse the matching date.
    const dateString = token.value.split(":")[1];
    const unixTime = Date.parse(dateString);
    if (Number.isNaN(unixTime)) {
      // Specified date is invalid.
      return false;
    }
    this.date = new Date(unixTime);

    return true;
  }

  /**
   * @inheritDoc
   */
  override isMatched(): boolean {
    return this.condition !== null && this.date !== null;
  }

  /**
   * Generates a RangeDate object corresponding to this particular date and
   * condition.
   * @private
   * @return {RangeDate} The RangeDate it generated.
   */
  private getDateRange(): RangeDate {
    const isoDate = this.date?.toDateString().split("T")[0] as string;

    switch (this.condition) {
      case DateCondition.BEFORE:
        return { minValue: "9999-12-31", maxValue: isoDate };
      case DateCondition.ON:
        return { minValue: isoDate, maxValue: isoDate };
      case DateCondition.AFTER:
        return { minValue: isoDate, maxValue: "9999-12-31" };
    }
  }

  /**
   * @inheritDoc
   */
  override makeQueries(): ImageQuery[] {
    return [{ captureDates: this.getDateRange() }];
  }
}

/**
 * Order in which we try to expand predicates when parsing.
 */
const PREDICATE_ORDER = [CaptureDatePredicate, StringPredicate];

/**
 * Parses a search string.
 * @param {string} searchString The raw search string.
 * @return {Predicate[]} The associated predicates.
 */
function parse(searchString: string): Predicate[] {
  const tokens = searchString.split(" ").map((t) => new Token(t));
  // Add special end token.
  tokens.push(new Token());

  let tokenIndex = 0;
  let predicateIndex = 0;
  let currentPredicate: Predicate = new PREDICATE_ORDER[predicateIndex]();
  const predicates: Predicate[] = [];
  while (tokenIndex < tokens.length) {
    if (currentPredicate.parse(tokens[tokenIndex])) {
      // It consumed this token.
      ++tokenIndex;

      if (currentPredicate.isMatched()) {
        // Predicate is fully matched. Start a new one.
        predicates.push(currentPredicate);
        predicateIndex = 0;
        currentPredicate = new PREDICATE_ORDER[predicateIndex]();
      }
    } else {
      // It rejected this token. Try the next predicate.
      currentPredicate = new PREDICATE_ORDER[++predicateIndex]();
    }
  }

  // Check if we have a last matched predicate.
  if (currentPredicate.isMatched()) {
    predicates.push(currentPredicate);
  }

  return predicates;
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

  startIndex = Math.max(startIndex, 0);
  endIndex = Math.min(endIndex, fieldText.length);

  // If we still have some more length to fill, try expanding.
  let lengthBudget = desiredLength - (endIndex - startIndex);
  if (lengthBudget > 0) {
    startIndex = Math.max(startIndex - lengthBudget, 0);
    lengthBudget = desiredLength - endIndex - startIndex;
  }
  if (lengthBudget > 0) {
    endIndex = Math.min(endIndex + lengthBudget, fieldText.length);
  }

  // Add ellipses to indicate to the user that some text is not shown.
  let prefix = "";
  let suffix = "";
  if (startIndex > 0) {
    prefix = "...";
  }
  if (endIndex < fieldText.length) {
    suffix = "...";
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
  // First, parse the search string.
  const predicates = parse(searchString);

  // Build the query appropriately.
  const query = [];

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
