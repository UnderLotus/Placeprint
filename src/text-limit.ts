/**
 * Truncate a value using an HTML maxlength measured in UTF-16 code units,
 * while never leaving a dangling surrogate pair behind.
 */
export function truncateToMaxLength(value: string, maxLength: number): string {
  if (maxLength <= 0 || !value) {
    return '';
  }

  let usedUnits = 0;
  let result = '';
  for (const character of value) {
    const units = character.length;
    if (usedUnits + units > maxLength) {
      break;
    }
    result += character;
    usedUnits += units;
  }
  return result;
}

export function setInputValueClamped(
  input: HTMLInputElement,
  value: string,
  maxLength = input.maxLength,
): void {
  input.value = truncateToMaxLength(value, maxLength > 0 ? maxLength : Number.MAX_SAFE_INTEGER);
}
