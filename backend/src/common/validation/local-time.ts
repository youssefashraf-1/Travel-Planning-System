export const LOCAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function isIanaTimeZone(value: string): boolean {
  // Fixed offsets cannot represent daylight saving changes.
  if (/^[+-]/.test(value)) {
    return false;
  }

  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
