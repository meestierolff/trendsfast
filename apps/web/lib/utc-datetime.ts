const UTC_FIELD = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

export function isoToUtcDateTimeValue(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("A valid UTC instant is required");
  return parsed.toISOString().slice(0, 23);
}

export function utcDateTimeValueToIso(value: string): string {
  const match = UTC_FIELD.exec(value);
  if (!match) throw new Error("A valid UTC date and time is required");
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, millisText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText ?? "0");
  const millis = Number((millisText ?? "0").padEnd(3, "0"));
  const parsed = new Date(0);
  parsed.setUTCFullYear(year, month - 1, day);
  parsed.setUTCHours(hour, minute, second, millis);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day ||
    parsed.getUTCHours() !== hour ||
    parsed.getUTCMinutes() !== minute ||
    parsed.getUTCSeconds() !== second ||
    parsed.getUTCMilliseconds() !== millis
  ) {
    throw new Error("A valid UTC date and time is required");
  }
  return parsed.toISOString();
}
