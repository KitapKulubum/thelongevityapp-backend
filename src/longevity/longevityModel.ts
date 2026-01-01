/**
 * Longevity Scoring Engine - Data Models
 * Explainable scoring system with BAO (Biological Age Offset) and DAV (Daily Aging Velocity)
 */

/**
 * Shared Longevity data models
 */

export interface OnboardingAnswers {
  activity: number;
  smokingAlcohol: number;
  metabolicHealth: number;
  energyFocus: number;
  visceralFat: number;
  sleep: number;
  stress: number;
  muscle: number;
  nutritionPattern: number;
  sugar: number;
}

export interface OnboardingSubmitRequest {
  userId?: string; // ignored when auth is used
  chronologicalAgeYears: number;
  answers: OnboardingAnswers;
}

export interface OnboardingSubmitResponse {
  userId: string;
  chronologicalAgeYears: number;
  baselineBiologicalAgeYears: number;
  currentBiologicalAgeYears: number;
  BAOYears: number;
  totalScore: number;
}

export interface UserDocument {
  userId: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  dateOfBirth?: string | null; // ISO date string, e.g. "1990-05-15"
  timezone?: string | null; // IANA timezone string, e.g. "Europe/Istanbul", "America/New_York"
  chronologicalAgeYears: number;
  onboardingAnswers: OnboardingAnswers;
  onboardingTotalScore: number;
  baselineBiologicalAgeYears: number;
  baselineBAOYears: number;
  currentBiologicalAgeYears: number;
  currentAgingDebtYears: number;
  rejuvenationStreakDays: number;
  accelerationStreakDays: number;
  totalRejuvenationDays: number;
  totalAccelerationDays: number;
  createdAt: string;
  updatedAt: string;
}

export interface DailyMetrics {
  date: string; // yyyy-MM-dd
  sleepHours: number;
  steps: number;
  vigorousMinutes: number;
  processedFoodScore: number;
  alcoholUnits: number;
  stressLevel: number;
  lateCaffeine: boolean;
  screenLate: boolean;
  bedtimeHour: number;
}

export interface DailyEntryDocument {
  userId: string; // User ID for querying
  dateKey: string; // YYYY-MM-DD format computed in user's timezone
  date: string; // Kept for backward compatibility (same as dateKey)
  sleepHours: number;
  steps: number;
  vigorousMinutes: number;
  processedFoodScore: number;
  alcoholUnits: number;
  stressLevel: number;
  lateCaffeine: boolean;
  screenLate: boolean;
  bedtimeHour: number;
  score: number;
  deltaYears: number;
  reasons: string[];
  currentBiologicalAgeYears?: number;
  currentAgingDebtYears?: number;
  rejuvenationStreakDays?: number;
  accelerationStreakDays?: number;
  createdAt: string;
}

export interface BiologicalAgeState {
  chronologicalAgeYears: number;
  baselineBiologicalAgeYears: number;
  currentBiologicalAgeYears: number;
  agingDebtYears: number;
  rejuvenationStreakDays: number;
  accelerationStreakDays: number;
  totalRejuvenationDays: number;
  totalAccelerationDays: number;
}

export interface TodayEntry {
  date: string;
  score: number;
  deltaYears: number;
  reasons: string[];
}

export interface DailyUpdateResponse {
  state: BiologicalAgeState;
  today: TodayEntry;
}

export interface HistoryPoint {
  date: string; // yyyy-MM-dd
  biologicalAgeYears: number;
  deltaYears: number;
  score: number;
}

export interface StatsSummaryResponse {
  userId: string;
  state: BiologicalAgeState;
  today?: TodayEntry;
  weeklyHistory: HistoryPoint[];
  monthlyHistory: HistoryPoint[];
  yearlyHistory: HistoryPoint[];
  hasCompletedOnboarding: boolean;
}

