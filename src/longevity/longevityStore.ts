/**
 * Longevity Firestore Operations (unified schema)
 */

import * as admin from 'firebase-admin';
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
 * Save or update a daily entry.
 */
export async function saveDailyEntry(
  userId: string,
  metrics: DailyMetrics,
  result: { score: number; deltaYears: number; reasons: string[] },
  snapshot?: Partial<DailyEntryDocument>
): Promise<void> {
  const ref = firestore.collection('users').doc(userId).collection('dailyEntries').doc(metrics.date);
  const existing = await ref.get();
  const createdAt = existing.exists
    ? existing.data()?.createdAt ?? serverTimestamp()
    : serverTimestamp();

  const doc: Partial<DailyEntryDocument> = {
    date: metrics.date,
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
    createdAt,
    ...snapshot,
  };

  await ref.set(
    {
      ...doc,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function getDailyEntry(
  userId: string,
  date: string
): Promise<DailyEntryDocument | null> {
  const ref = firestore.collection('users').doc(userId).collection('dailyEntries').doc(date);
  const snap = await ref.get();
  if (!snap.exists) return null;
  return firestoreToJSON(snap.data()) as DailyEntryDocument;
}

/**
 * List all daily entries (sorted ascending by date).
 */
export async function listDailyEntries(userId: string): Promise<DailyEntryDocument[]> {
  const ref = firestore.collection('users').doc(userId).collection('dailyEntries');
  const snap = await ref.get();
  if (snap.empty) return [];
  const docs = snap.docs.map((d) => firestoreToJSON(d.data()) as DailyEntryDocument);
  return docs.sort((a, b) => a.date.localeCompare(b.date));
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

