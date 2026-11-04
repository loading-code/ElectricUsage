const SEASONAL_PEAK_START_YEAR = 2026;
const SEASONAL_PEAK_START_MONTH = 4;
const SEASONAL_PEAK_END_MONTH = 9;

/** True when an interval is billed at the weekday peak rate. */
export function isPeakPeriod(timestamp: number) {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDay();
  const minute = date.getUTCHours() * 60 + date.getUTCMinutes();
  const seasonalWindowApplies =
    year < SEASONAL_PEAK_START_YEAR ||
    (month >= SEASONAL_PEAK_START_MONTH &&
      month <= SEASONAL_PEAK_END_MONTH);

  return (
    seasonalWindowApplies &&
    day >= 1 &&
    day <= 5 &&
    ((minute >= 7 * 60 && minute < 11 * 60) ||
      (minute >= 17 * 60 && minute < 21 * 60))
  );
}
