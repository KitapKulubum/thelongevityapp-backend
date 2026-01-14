import * as admin from 'firebase-admin';
import { firestore, firestoreToJSON } from '../config/firestore';

export interface UserProfile {
  userId: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  dateOfBirth?: string | null; // ISO date string, e.g. "1990-05-15"
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
 * Calculates chronological age in years (with decimals) from a date of birth (ISO date string).
 * Returns age in XX.XX format (e.g., 35.75 for 35 years and 9 months).
 * Returns null if dateOfBirth is invalid or missing.
 */
export function calculateAgeFromDateOfBirth(dateOfBirth: string | null | undefined): number | null {
  if (!dateOfBirth) return null;
  
  try {
    const birthDate = new Date(dateOfBirth + 'T00:00:00');
    const today = new Date();
    
    // Check if date is valid
    if (isNaN(birthDate.getTime())) return null;
    
    // Check if birth date is not in the future
    if (birthDate > today) return null;
    
    // Calculate age in milliseconds
    const ageInMs = today.getTime() - birthDate.getTime();
    
    // Convert to years with decimals
    // Average year length: 365.25 days (accounting for leap years)
    const msPerYear = 365.25 * 24 * 60 * 60 * 1000;
    const ageInYears = ageInMs / msPerYear;
    
    // Round to 2 decimal places and ensure non-negative
    return Math.max(0, Math.round(ageInYears * 100) / 100);
  } catch (error) {
    console.error('[calculateAgeFromDateOfBirth] error:', error);
    return null;
  }
}

/**
 * Reads or creates a user profile document at users/{uid}.
 * Ensures longevity-compatible defaults exist.
 */
export async function getOrCreateUserProfile(
  uid: string,
  email?: string | null,
  profileData?: { firstName?: string; lastName?: string; dateOfBirth?: string }
): Promise<UserProfile> {
  const userRef = firestore.collection('users').doc(uid);
  const snap = await userRef.get();
  const now = new Date().toISOString();

  if (!snap.exists) {
    // Calculate chronological age from dateOfBirth if provided
    const chronologicalAgeYears = profileData?.dateOfBirth
      ? calculateAgeFromDateOfBirth(profileData.dateOfBirth)
      : null;

    const profile: UserProfile = {
      userId: uid,
      email: email ?? null,
      firstName: profileData?.firstName ?? null,
      lastName: profileData?.lastName ?? null,
      dateOfBirth: profileData?.dateOfBirth ?? null,
      chronologicalAgeYears,
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
  const existingProfile = data as UserProfile;
  
  // If profileData is provided, update the profile (e.g., during sign-up)
  const updates: any = {};
  if (profileData) {
    if (profileData.firstName !== undefined) {
      updates.firstName = profileData.firstName || null;
    }
    if (profileData.lastName !== undefined) {
      updates.lastName = profileData.lastName || null;
    }
    if (profileData.dateOfBirth !== undefined) {
      updates.dateOfBirth = profileData.dateOfBirth || null;
    }
  }
  
  // Determine chronologicalAgeYears
  // Priority: 1) dateOfBirth from profileData, 2) existing dateOfBirth, 3) existing chronologicalAgeYears
  const dateOfBirthToUse = profileData?.dateOfBirth ?? existingProfile.dateOfBirth;
  let chronologicalAgeYears = existingProfile.chronologicalAgeYears;
  
  if (dateOfBirthToUse) {
    // Always recalculate from dateOfBirth to keep age current (updates continuously)
    const calculatedAge = calculateAgeFromDateOfBirth(dateOfBirthToUse);
    if (calculatedAge !== null) {
      chronologicalAgeYears = calculatedAge;
      // Always update if age has changed (to ensure continuous updates)
      if (existingProfile.chronologicalAgeYears === null || 
          existingProfile.chronologicalAgeYears === undefined ||
          calculatedAge !== existingProfile.chronologicalAgeYears) {
      updates.chronologicalAgeYears = calculatedAge;
    }
    }
  }
  
  // Apply updates if any
  if (Object.keys(updates).length > 0) {
    updates.updatedAt = now;
    await userRef.set(updates, { merge: true });
  }
  
  return {
    ...existingProfile,
    email: existingProfile?.email ?? email ?? null,
    userId: uid,
    firstName: profileData?.firstName !== undefined ? (profileData.firstName || null) : existingProfile.firstName,
    lastName: profileData?.lastName !== undefined ? (profileData.lastName || null) : existingProfile.lastName,
    dateOfBirth: dateOfBirthToUse ?? existingProfile.dateOfBirth ?? null,
    chronologicalAgeYears,
  };
}

