/**
 * Checks that a value can be used as Fetch request headers.
 *
 * @param value - Candidate header record.
 * @returns Whether the value contains only syntactically valid string headers.
 */
export function isValidHttpHeaders(value: unknown): value is Record<string, string> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !Object.values(value).every(item => typeof item === 'string')
  ) {
    return false;
  }
  try {
    new Headers(value as Record<string, string>);
    return true;
  } catch {
    return false;
  }
}
