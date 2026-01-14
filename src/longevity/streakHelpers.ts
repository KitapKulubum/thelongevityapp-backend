/**
 * Streak calculation helpers
 * Calendar-day based streak logic using user's timezone
 */

import { DateTime } from 'luxon';

/**
 * Get day key (YYYY-MM-DD) for a given date in the specified timezone
 * @param date - Date object or ISO string
 * @param timezone - IANA timezone string (e.g., "Europe/Istanbul")
 * @returns Day key string in YYYY-MM-DD format
 */
export function getDayKey(date: Date | string, timezone: string): string {
  const tz = timezone || 'UTC';
  let dt: DateTime;

  if (date instanceof Date) {
    dt = DateTime.fromJSDate(date, { zone: tz });
  } else {
    dt = DateTime.fromISO(date, { zone: tz });
  }

  if (!dt.isValid) {
    // Fallback to UTC
    const fallbackDt = date instanceof Date
      ? DateTime.fromJSDate(date, { zone: 'utc' })
      : DateTime.fromISO(date, { zone: 'utc' });
    return fallbackDt.toISODate() || '';
  }

  const dayKey = dt.toISODate();
  if (!dayKey) {
    throw new Error('Failed to generate day key');
  }

  return dayKey;
}

/**
 * Calculate days between two day keys (YYYY-MM-DD format)
 * Returns the number of calendar days difference
 * @param dayKeyA - First day key (YYYY-MM-DD)
 * @param dayKeyB - Second day key (YYYY-MM-DD)
 * @param timezone - IANA timezone string for proper date parsing
 * @returns Number of days difference (positive if dayKeyB is after dayKeyA)
 */
export function daysBetween(dayKeyA: string, dayKeyB: string, timezone: string = 'UTC'): number {
  const dtA = DateTime.fromISO(dayKeyA, { zone: timezone }).startOf('day');
  const dtB = DateTime.fromISO(dayKeyB, { zone: timezone }).startOf('day');

  if (!dtA.isValid || !dtB.isValid) {
    throw new Error('Invalid day key format');
  }

  const diff = dtB.diff(dtA, 'days');
  return Math.round(diff.as('days'));
}

/**
 * Calculate streak based on last check-in day and today
 * @param lastCheckinDayKey - Last check-in day key (YYYY-MM-DD) or null
 * @param todayDayKey - Today's day key (YYYY-MM-DD)
 * @param currentStreak - Current streak count
 * @param timezone - IANA timezone string
 * @returns New streak count
 */
export function calculateStreak(
  lastCheckinDayKey: string | null,
  todayDayKey: string,
  currentStreak: number,
  timezone: string = 'UTC'
): number {
  // No previous check-in: start with streak = 1
  if (!lastCheckinDayKey) {
    return 1;
  }

  // Same day: do not increment (should not happen due to duplicate check, but handle safely)
  if (lastCheckinDayKey === todayDayKey) {
    return currentStreak; // Keep current streak unchanged
  }

  // Calculate days difference
  const daysDiff = daysBetween(lastCheckinDayKey, todayDayKey, timezone);

  // Exactly 1 day ago (yesterday): increment streak
  if (daysDiff === 1) {
    return currentStreak + 1;
  }

  // Gap of 2+ days: reset to 1
  if (daysDiff >= 2) {
    return 1;
  }

  // Negative difference (future date - shouldn't happen): keep current streak
  if (daysDiff < 0) {
    console.warn('[calculateStreak] Future date detected, keeping current streak');
    return currentStreak;
  }

  // Should not reach here, but default to 1
  return 1;
}

