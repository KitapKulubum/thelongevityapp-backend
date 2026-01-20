/**
 * Longevity Firestore Operations (unified schema)
 */

import * as admin from 'firebase-admin';
import { DateTime } from 'luxon';
import { firestore, firestoreToJSON } from '../config/firestore';
import { calculateAgeFromDateOfBirth } from '../auth/firebaseAuth';
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
      chronologicalAgeYearsAtOnboarding: chronologicalAgeYears, // Store chronological age at onboarding time
      onboardingAnswers: answers,
      onboardingTotalScore,
      baselineBiologicalAgeYears,
      baselineBAOYears,
      currentBiologicalAgeYears,
      currentAgingDebtYears,
      rejuvenationStreakDays: 0,
      totalRejuvenationDays: 0,
      createdAt,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * Fetch user root doc.
 * Automatically updates chronologicalAgeYears from dateOfBirth if available.
 */
export async function getUserDocument(userId: string): Promise<UserDocument | null> {
  const doc = await firestore.collection('users').doc(userId).get();
  if (!doc.exists) return null;
  
  const userData = firestoreToJSON(doc.data()) as UserDocument;
  
  // If dateOfBirth exists, automatically recalculate chronologicalAgeYears
  // This ensures age stays current as days pass (updates continuously)
  if (userData.dateOfBirth) {
    const calculatedAge = calculateAgeFromDateOfBirth(userData.dateOfBirth);
    
    if (calculatedAge !== null) {
      // Always update chronological age to ensure it increases continuously
      // Only skip update if the calculated age is exactly the same (to avoid unnecessary writes)
      if (userData.chronologicalAgeYears === null || 
          userData.chronologicalAgeYears === undefined ||
          calculatedAge !== userData.chronologicalAgeYears) {
        // Update in Firestore
        await doc.ref.update({
          chronologicalAgeYears: calculatedAge,
          updatedAt: serverTimestamp(),
        });
        // Update local data
        userData.chronologicalAgeYears = calculatedAge;
      }
    }
  }
  
  return userData;
}

/**
 * Check if user has completed onboarding.
 * Returns true if user document exists and has onboardingAnswers field.
 */
export async function hasCompletedOnboarding(userId: string): Promise<boolean> {
  const userDoc = await getUserDocument(userId);
  if (!userDoc) {
    console.log('[hasCompletedOnboarding] User document not found for userId:', userId);
    return false;
  }
  
  // Check if onboardingAnswers exists and is not empty/undefined
  const hasAnswers = !!(userDoc.onboardingAnswers && typeof userDoc.onboardingAnswers === 'object');
  
  // Additional check: verify onboardingAnswers has required fields
  if (hasAnswers && userDoc.onboardingAnswers) {
    const requiredFields = ['activity', 'smokingAlcohol', 'metabolicHealth', 'energyFocus', 
                           'visceralFat', 'sleep', 'stress', 'muscle', 'nutritionPattern', 'sugar'];
    const hasAllFields = requiredFields.every(field => 
      userDoc.onboardingAnswers![field as keyof typeof userDoc.onboardingAnswers] !== undefined &&
      userDoc.onboardingAnswers![field as keyof typeof userDoc.onboardingAnswers] !== null
    );
    
    if (!hasAllFields) {
      console.log('[hasCompletedOnboarding] User has onboardingAnswers but missing required fields:', userId);
      return false;
    }
  }
  
  console.log('[hasCompletedOnboarding] userId:', userId, 'hasCompletedOnboarding:', hasAnswers);
  return hasAnswers;
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
 * Get last N daily entries sorted by date ascending (for trends).
 * Returns up to 365 entries.
 */
export async function getDailyEntriesForTrends(
  userId: string,
  limit: number = 365
): Promise<DailyEntryDocument[]> {
  const allEntries = await listDailyEntries(userId);
  // Return last N entries (most recent)
  return allEntries.slice(-limit);
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
    totalRejuvenationDays: number;
    lastCheckinDayKey?: string;
    lastCheckinAt?: string;
  }
): Promise<void> {
  const userRef = firestore.collection('users').doc(userId);
  const updates: any = {
      ...state,
      updatedAt: serverTimestamp(),
  };

  // Only update lastCheckinDayKey and lastCheckinAt if provided
  if (state.lastCheckinDayKey !== undefined) {
    updates.lastCheckinDayKey = state.lastCheckinDayKey;
  }
  if (state.lastCheckinAt !== undefined) {
    updates.lastCheckinAt = state.lastCheckinAt;
  }

  await userRef.set(updates, { merge: true });
}

/**
 * Save a chat message to conversation history.
 */
export async function saveChatMessage(
  userId: string,
  role: 'user' | 'assistant',
  content: string
): Promise<void> {
  const ref = firestore.collection('users').doc(userId).collection('chatHistory');
  await ref.add({
    userId,
    role,
    content,
    createdAt: serverTimestamp(),
  });
}

/**
 * Get recent chat history for a user (last N messages).
 */
export async function getChatHistory(
  userId: string,
  limit: number = 10
): Promise<Array<{ role: 'user' | 'assistant'; content: string; createdAt: string }>> {
  const ref = firestore.collection('users').doc(userId).collection('chatHistory');
  const snap = await ref.orderBy('createdAt', 'desc').limit(limit).get();
  
  if (snap.empty) return [];
  
  const messages = snap.docs
    .map((doc) => {
      const data = firestoreToJSON(doc.data());
      return {
        role: data.role as 'user' | 'assistant',
        content: data.content as string,
        createdAt: data.createdAt as string,
      };
    })
    .reverse(); // Reverse to get chronological order
  
  return messages;
}

