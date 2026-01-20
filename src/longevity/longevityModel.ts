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
  chronologicalAgeYearsAtOnboarding?: number | null; // Chronological age at the time of onboarding (for baseline delta calculation)
  onboardingAnswers: OnboardingAnswers;
  onboardingTotalScore: number;
  baselineBiologicalAgeYears: number;
  baselineBAOYears: number;
  currentBiologicalAgeYears: number;
  currentAgingDebtYears: number;
  rejuvenationStreakDays: number;
  totalRejuvenationDays: number;
  // Subscription fields
  subscriptionStatus?: 'active' | 'expired' | null;
  subscriptionPlan?: 'membership_monthly' | 'membership_yearly' | null;
  subscriptionRenewalDate?: string | null; // ISO date string
  subscriptionOriginalTransactionId?: string | null; // Apple original transaction ID
  // Streak tracking fields
  lastCheckinDayKey?: string | null; // YYYY-MM-DD in user's timezone
  lastCheckinAt?: string | null; // ISO timestamp
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
  createdAt: string;
}

export interface BiologicalAgeState {
  chronologicalAgeYears: number;
  baselineBiologicalAgeYears: number;
  currentBiologicalAgeYears: number;
  agingDebtYears: number;
  rejuvenationStreakDays: number;
  totalRejuvenationDays: number;
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

/**
 * Trend data point for charts
 */
export interface TrendPoint {
  date: string; // YYYY-MM-DD
  biologicalAge: number;
}

/**
 * Trend period data (weekly, monthly, yearly)
 */
export interface TrendPeriod {
  value: number | null; // Change in biological age (rounded to 2 decimals)
  available: boolean; // Whether enough data exists
  projection?: boolean; // Whether this is a projection (only for yearly)
  points?: TrendPoint[]; // Chart data points
}

/**
 * Response for GET /api/longevity/trends
 * 
 * Example response:
 * {
 *   "weekly": { "value": -0.32, "available": true, "points": [...] },
 *   "monthly": { "value": -1.10, "available": true, "points": [...] },
 *   "yearly": { "value": -4.20, "available": false, "projection": true, "points": [...] }
 * }
 */
export interface TrendResponse {
  weekly: TrendPeriod;
  monthly: TrendPeriod;
  yearly: TrendPeriod;
}

/**
 * Delta Analytics Response Models
 */

export interface DeltaSeriesPoint {
  date: string; // YYYY-MM-DD for weekly/monthly
  dailyDeltaYears: number | null; // Daily delta for that day (null if no check-in)
}

export interface MonthlyDeltaSeriesPoint {
  month: string; // YYYY-MM format
  netDelta: number; // Sum of deltas for that month
  checkIns: number; // Count of check-ins in that month
  avgDeltaPerCheckIn: number; // netDelta / checkIns
}

export interface DeltaSummary {
  netDeltaYears: number; // baselineDeltaYears + sum(all daily deltas from onboarding to date)
  rejuvenationYears: number; // sum(max(dailyDelta, 0)) - positive deltas (rejuvenation)
  agingYears: number; // sum(abs(min(dailyDelta, 0))) - negative deltas (aging, as positive)
  checkIns: number; // count of check-ins in range
  rangeNetDeltaYears: number; // sum(daily deltas only in selected range)
}

export interface WeeklyDeltaResponse {
  range: 'weekly';
  timezone: string;
  baselineDeltaYears: number; // baselineBiologicalAge - chronologicalAge
  totalDeltaYears: number; // baselineDeltaYears + sum(all daily deltas from onboarding)
  start: string; // YYYY-MM-DD (Monday)
  end: string; // YYYY-MM-DD (Sunday)
  series: DeltaSeriesPoint[];
  summary: DeltaSummary;
}

export interface MonthlyDeltaResponse {
  range: 'monthly';
  timezone: string;
  baselineDeltaYears: number; // baselineBiologicalAge - chronologicalAge
  totalDeltaYears: number; // baselineDeltaYears + sum(all daily deltas from onboarding)
  start: string; // YYYY-MM-DD (first day of month)
  end: string; // YYYY-MM-DD (last day of month)
  series: DeltaSeriesPoint[];
  summary: DeltaSummary;
}

export interface YearlyDeltaResponse {
  range: 'yearly';
  timezone: string;
  baselineDeltaYears: number; // baselineBiologicalAge - chronologicalAge
  totalDeltaYears: number; // baselineDeltaYears + sum(all daily deltas from onboarding)
  start: string; // YYYY-MM-DD (first day of year)
  end: string; // YYYY-MM-DD (last day of year)
  series: MonthlyDeltaSeriesPoint[];
  summary: DeltaSummary;
}

export type DeltaAnalyticsResponse = WeeklyDeltaResponse | MonthlyDeltaResponse | YearlyDeltaResponse;

/**
 * Metric scores (0-100) for each health metric
 */
export interface MetricScores {
  sleepHours: number; // 0-100
  steps: number; // 0-100
  vigorousMinutes: number; // 0-100
  processedFoodScore: number; // 0-100 (inverted: lower processedFoodScore = higher score)
  alcoholUnits: number; // 0-100 (0 units = 100, more units = lower score)
  stressLevel: number; // 0-100 (low stress = high score)
  lateCaffeine: number; // 0 or 100 (false = 100, true = 0)
  screenLate: number; // 0 or 100 (false = 100, true = 0)
  bedtimeHour: number; // 0-100 (optimal bedtime = 100)
}

export interface MetricsScoresResponse {
  userId: string;
  scores: MetricScores;
  averages: {
    sleepHours: number;
    steps: number;
    vigorousMinutes: number;
    processedFoodScore: number;
    alcoholUnits: number;
    stressLevel: number;
    lateCaffeine: number; // percentage of days with late caffeine (0-1)
    screenLate: number; // percentage of days with late screen (0-1)
    bedtimeHour: number;
  };
  dataPoints: number; // number of check-ins used for calculation
  period: {
    start: string; // YYYY-MM-DD
    end: string; // YYYY-MM-DD
  };
}

