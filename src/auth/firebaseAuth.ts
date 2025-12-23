import * as admin from 'firebase-admin';
import { firestore, firestoreToJSON } from '../config/firestore';

export interface UserProfile {
  userId: string;
  email?: string | null;
  chronologicalAgeYears: number | null;
  baselineBiologicalAgeYears: number | null;
  currentBiologicalAgeYears: number | null;
  currentAgingDebtYears: number;
  rejuvenationStreakDays: number;
  accelerationStreakDays: number;
  totalRejuvenationDays: number;
  totalAccelerationDays: number;
  createdAt: string;
  updatedAt: string;
}

export interface AuthUser {
  uid: string;
  email?: string | null;
}

/**
 * Verifies a Firebase ID token. Throws on invalid/expired token.
 */
export async function verifyIdToken(idToken: string): Promise<admin.auth.DecodedIdToken> {
  return admin.auth().verifyIdToken(idToken);
}

/**
 * Reads or creates a user profile document at users/{uid}.
 * Ensures longevity-compatible defaults exist.
 */
export async function getOrCreateUserProfile(uid: string, email?: string | null): Promise<UserProfile> {
  const userRef = firestore.collection('users').doc(uid);
  const snap = await userRef.get();
  const now = new Date().toISOString();

  if (!snap.exists) {
    const profile: UserProfile = {
      userId: uid,
      email: email ?? null,
      chronologicalAgeYears: null,
      baselineBiologicalAgeYears: null,
      currentBiologicalAgeYears: null,
      currentAgingDebtYears: 0,
      rejuvenationStreakDays: 0,
      accelerationStreakDays: 0,
      totalRejuvenationDays: 0,
      totalAccelerationDays: 0,
      createdAt: now,
      updatedAt: now,
    };
    await userRef.set(profile);
    return profile;
  }

  const data = firestoreToJSON(snap.data());
  return {
    ...(data as UserProfile),
    email: data?.email ?? email ?? null,
    userId: uid,
  };
}

