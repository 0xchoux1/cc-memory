/**
 * Safe JSON parsing utilities to prevent crashes from malformed data
 */

/**
 * Safely parse a JSON string, returning the fallback value if parsing fails.
 * This prevents crashes from corrupted or malformed data stored in the database.
 */
export function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/**
 * Safely parse a JSON string that may be null/undefined.
 * Returns undefined if the value is null/undefined or if parsing fails.
 */
export function safeJsonParseOptional<T>(value: string | null | undefined): T | undefined {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}
