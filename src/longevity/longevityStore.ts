/**
 * Longevity Firestore Operations (unified schema)
 */

import * as admin from 'firebase-admin';
import { DateTime } from 'luxon';
import { firestore, firestoreToJSON } from '../config/firestore';
import {
  DailyEntryDocument,
  DailyMetrics,
  OnboardingAnswers,
  UserDocument,
} from './longevityModel';

const serverTimestamp = () => admin.firestore.FieldValue.serverTimestamp();
const nowIso = () => new Date().toISOString();

/**
 * Get today's date key (YYYY-MM-DD) in the user's timezone.
 * Converts current UTC time to the specified timezone and returns the date string.
 * @param timezone IANA timezone string (e.g., "Europe/Istanbul", "America/New_York")
 * @returns Date string in YYYY-MM-DD format
 */
export function getTodayDateKey(timezone: string): string {
  // Default to UTC if timezone is not provided or invalid
  const tz = timezone || 'UTC';
  try {
    const now = DateTime.now().setZone(tz);
    if (!now.isValid) {
      console.warn(`[getTodayDateKey] Invalid timezone ${tz}, falling back to UTC`);
      return DateTime.now().toUTC().toISODate() || '';
    }
    const dateKey = now.toISODate();
    if (!dateKey) {
      throw new Error('Failed to generate date key');
    }
    return dateKey;
  } catch (error) {
    console.error(`[getTodayDateKey] Error with timezone ${tz}, falling back to UTC:`, error);
    return DateTime.now().toUTC().toISODate() || '';
  }
}

/**
 * Upsert user root doc from onboarding.
 */
export async function upsertUserOnboarding(params: {
  userId: string;
  chronologicalAgeYears: number;
  answers: OnboardingAnswers;
  onboardingTotalScore: number;
  baselineBiologicalAgeYears: number;
  baselineBAOYears: number;
}): Promise<void> {
  const { userId, chronologicalAgeYears, answers, onboardingTotalScore, baselineBiologicalAgeYears, baselineBAOYears } =
    params;

  const userRef = firestore.collection('users').doc(userId);
  const existing = await userRef.get();

  const base: Partial<UserDocument> | undefined = existing.exists
    ? (firestoreToJSON(existing.data()) as UserDocument)
    : undefined;

  const createdAt = base?.createdAt ?? nowIso();
  const currentBiologicalAgeYears = baselineBiologicalAgeYears;
  const currentAgingDebtYears = currentBiologicalAgeYears - chronologicalAgeYears;

  await userRef.set(
    {
      userId,
      chronologicalAgeYears,
      onboardingAnswers: answers,
      onboardingTotalScore,
      baselineBiologicalAgeYears,
      baselineBAOYears,
      currentBiologicalAgeYears,
      currentAgingDebtYears,
      rejuvenationStreakDays: 0,
      accelerationStreakDays: 0,
      totalRejuvenationDays: 0,
      totalAccelerationDays: 0,
      createdAt,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * Fetch user root doc.
 */
export async function getUserDocument(userId: string): Promise<UserDocument | null> {
  const doc = await firestore.collection('users').doc(userId).get();
  if (!doc.exists) return null;
  return firestoreToJSON(doc.data()) as UserDocument;
}

/**
 * Check if user has completed onboarding.
 * Returns true if user document exists and has onboardingAnswers field.
 */
export async function hasCompletedOnboarding(userId: string): Promise<boolean> {
  const userDoc = await getUserDocument(userId);
  if (!userDoc) return false;
  // Check if onboardingAnswers exists and is not empty/undefined
  return !!(userDoc.onboardingAnswers && typeof userDoc.onboardingAnswers === 'object');
}

/**
 * Check if a daily entry exists for the given dateKey.
 */
export async function hasDailyEntryForDateKey(
  userId: string,
  dateKey: string
): Promise<boolean> {
  const ref = firestore.collection('users').doc(userId).collection('dailyEntries').doc(dateKey);
  const snap = await ref.get();
  return snap.exists;
}

/**
 * Save a new daily entry (throws error if entry already exists for dateKey).
 * This function does NOT allow updates - use it only for creating new entries.
 */
export async function saveDailyEntry(
  userId: string,
  dateKey: string,
  metrics: DailyMetrics,
  result: { score: number; deltaYears: number; reasons: string[] },
  snapshot?: Partial<DailyEntryDocument>
): Promise<void> {
  const ref = firestore.collection('users').doc(userId).collection('dailyEntries').doc(dateKey);
  
  // Check if entry already exists
  const existing = await ref.get();
  if (existing.exists) {
    throw new Error('Daily check-in already completed for this date');
  }

  const doc: Partial<DailyEntryDocument> = {
    userId,
    dateKey,
    date: dateKey, // Keep date for backward compatibility
    sleepHours: metrics.sleepHours,
    steps: metrics.steps,
    vigorousMinutes: metrics.vigorousMinutes,
    processedFoodScore: metrics.processedFoodScore,
    alcoholUnits: metrics.alcoholUnits,
    stressLevel: metrics.stressLevel,
    lateCaffeine: metrics.lateCaffeine,
    screenLate: metrics.screenLate,
    bedtimeHour: metrics.bedtimeHour,
    score: result.score,
    deltaYears: result.deltaYears,
    reasons: result.reasons,
    ...snapshot,
  };

  await ref.set({
    ...doc,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  } as any);
}

export async function getDailyEntry(
  userId: string,
  dateKey: string
): Promise<DailyEntryDocument | null> {
  const ref = firestore.collection('users').doc(userId).collection('dailyEntries').doc(dateKey);
  const snap = await ref.get();
  if (!snap.exists) return null;
  return firestoreToJSON(snap.data()) as DailyEntryDocument;
}

/**
 * List all daily entries (sorted ascending by dateKey/date).
 */
export async function listDailyEntries(userId: string): Promise<DailyEntryDocument[]> {
  const ref = firestore.collection('users').doc(userId).collection('dailyEntries');
  const snap = await ref.get();
  if (snap.empty) return [];
  const docs = snap.docs.map((d) => firestoreToJSON(d.data()) as DailyEntryDocument);
  // Sort by dateKey if available, otherwise fall back to date
  return docs.sort((a, b) => {
    const dateA = a.dateKey || a.date;
    const dateB = b.dateKey || b.date;
    return dateA.localeCompare(dateB);
  });
}

/**
 * Update root user state after daily application.
 */
export async function updateUserAfterDaily(
  userId: string,
  state: {
    currentBiologicalAgeYears: number;
    currentAgingDebtYears: number;
    rejuvenationStreakDays: number;
    accelerationStreakDays: number;
    totalRejuvenationDays: number;
    totalAccelerationDays: number;
  }
): Promise<void> {
  const userRef = firestore.collection('users').doc(userId);
  await userRef.set(
    {
      ...state,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

