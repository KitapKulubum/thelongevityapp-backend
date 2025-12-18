/**
 * Simple heuristic-based biological age model for tracking daily health metrics
 * and estimating biological age changes over time.
 *
 * NOTE: This is a simplified educational model and should not be used as medical advice.
 */

export interface DailyMetrics {
  date: string; // ISO date, e.g. "2025-12-04"
  sleepHours: number; // total sleep hours
  steps: number; // step count
  vigorousMinutes: number; // minutes of moderate/vigorous activity
  processedFoodScore: number; // 0 (perfect) – 10 (very processed)
  alcoholUnits: number; // drinks per day
  stressLevel: number; // 1 (very calm) – 10 (very stressed)
  lateCaffeine: boolean; // had caffeine after 15:00
  screenLate: boolean; // heavy screen use in last 2 hours before bed
  bedtimeHour: number; // 24h format, e.g. 22.5 for 22:30
}

export interface DailyAgeEntry {
  date: string;
  deltaYears: number; // daily biological age change in years
  reasons: string[]; // brief explanations for the delta
}

export interface BiologicalAgeState {
  chronologicalAgeYears: number; // actual age
  baselineBiologicalAgeYears: number; // starting biological age (often = chronological)
  currentBiologicalAgeYears: number; // updated daily
  agingDebtYears: number; // max(0, currentBiological - chronological)
  history: DailyAgeEntry[]; // recent days
  rejuvenationStreakDays: number; // consecutive days with negative deltaYears
  accelerationStreakDays: number; // consecutive days with positive deltaYears
  totalRejuvenationDays: number; // how many days had negative deltaYears
  totalAccelerationDays: number; // how many days had positive deltaYears
}

/**
 * Calculates a daily health score based on various lifestyle metrics.
 * Score ranges from -10 (worst) to +10 (best).
 *
 * @param metrics - Daily health metrics
 * @returns Score and human-readable reasons for the score
 */
export function calculateDailyScore(metrics: DailyMetrics): {
  score: number;
  deltaYears: number;
  reasons: string[];
} {
  // Start from neutral 5, nudge up/down based on simple heuristics.
  let score = 5;
  const reasons: string[] = [];

  // Sleep hours
  if (metrics.sleepHours >= 7 && metrics.sleepHours <= 8) {
    score += 2;
    reasons.push('Sleep in sweet spot (7–8h)');
  } else if (metrics.sleepHours >= 6 && metrics.sleepHours < 7) {
    score += 1;
    reasons.push('Sleep slightly short (6–7h)');
  } else if (metrics.sleepHours < 6) {
    score -= 2;
    reasons.push('Sleep very short (<6h)');
  } else if (metrics.sleepHours > 9) {
    score -= 1;
    reasons.push('Sleep long (>9h)');
  }

  // Steps
  if (metrics.steps >= 8000) {
    score += 2;
    reasons.push('Steps 8k+');
  } else if (metrics.steps >= 5000 && metrics.steps < 8000) {
    score += 1;
    reasons.push('Steps 5k–7.9k');
  } else if (metrics.steps < 5000) {
    score -= 1;
    reasons.push('Steps under 5k');
  }

  // Vigorous minutes
  if (metrics.vigorousMinutes >= 20) {
    score += 2;
    reasons.push('Vigorous 20m+');
  } else if (metrics.vigorousMinutes >= 10 && metrics.vigorousMinutes < 20) {
    score += 1;
    reasons.push('Vigorous 10–19m');
  } else if (metrics.vigorousMinutes <= 0) {
    score -= 1;
    reasons.push('No vigorous activity');
  }

  // Stress
  if (metrics.stressLevel <= 3) {
    score += 2;
    reasons.push('Low stress (<=3)');
  } else if (metrics.stressLevel >= 7) {
    score -= 2;
    reasons.push('High stress (>=7)');
  }

  // Late caffeine
  if (metrics.lateCaffeine) {
    score -= 1;
    reasons.push('Late caffeine');
  }

  // Late screen
  if (metrics.screenLate) {
    score -= 1;
    reasons.push('Late screen use');
  }

  // Clamp score between 0 and 10
  if (score > 10) score = 10;
  if (score < 0) score = 0;

  // Map score to biological age delta
  let deltaYears = 0;
  if (score >= 8) {
    deltaYears = -0.12; // Increased for demo visibility
  } else if (score >= 6) {
    deltaYears = -0.05;
  } else if (score >= 4) {
    deltaYears = 0.01;
  } else {
    deltaYears = 0.15;
  }

  return { score, deltaYears, reasons };
}

/**
 * Applies daily metrics to update the biological age state.
 * Converts the daily score into a biological age delta and updates the state.
 *
 * @param prev - Previous biological age state
 * @param metrics - Daily health metrics
 * @returns Updated state and the new daily entry
 */
export function applyDailyAgeUpdate(
  prev: BiologicalAgeState,
  metrics: DailyMetrics
): { next: BiologicalAgeState; entry: DailyAgeEntry } {
  const { score, deltaYears, reasons } = calculateDailyScore(metrics);

  // Compute new current biological age
  const currentBiologicalAgeYears =
    prev.currentBiologicalAgeYears + deltaYears;

  // Compute new aging debt (difference from baseline biological age)
  const agingDebtYears = currentBiologicalAgeYears - prev.baselineBiologicalAgeYears;

  // Update streaks based on threshold
  const threshold = 0.001;
  let rejuvenationStreakDays = prev.rejuvenationStreakDays;
  let accelerationStreakDays = prev.accelerationStreakDays;
  let totalRejuvenationDays = prev.totalRejuvenationDays;
  let totalAccelerationDays = prev.totalAccelerationDays;

  if (deltaYears <= -threshold) {
    rejuvenationStreakDays += 1;
    accelerationStreakDays = 0;
    totalRejuvenationDays += 1;
  } else if (deltaYears >= threshold) {
    accelerationStreakDays += 1;
    rejuvenationStreakDays = 0;
    totalAccelerationDays += 1;
  }
  // If deltaYears === 0, keep both streaks and totals as they were

  // Build daily entry
  const entry: DailyAgeEntry = {
    date: metrics.date,
    deltaYears,
    reasons,
  };

  // Append to history and keep last ~30 entries
  const history = [...prev.history, entry].slice(-30);

  // Build new state
  const next: BiologicalAgeState = {
    ...prev,
    currentBiologicalAgeYears,
    agingDebtYears,
    history,
    rejuvenationStreakDays,
    accelerationStreakDays,
    totalRejuvenationDays,
    totalAccelerationDays,
  };

  return { next, entry };
}

/**
 * Creates an initial biological age state for a user.
 * Sets biological age equal to chronological age at start.
 *
 * @param chronologicalAgeYears - User's actual age in years
 * @returns Initial biological age state
 */
export function createInitialBiologicalAgeState(
  chronologicalAgeYears: number
): BiologicalAgeState {
  return {
    chronologicalAgeYears,
    baselineBiologicalAgeYears: chronologicalAgeYears,
    currentBiologicalAgeYears: chronologicalAgeYears,
    agingDebtYears: 0,
    history: [],
    rejuvenationStreakDays: 0,
    accelerationStreakDays: 0,
    totalRejuvenationDays: 0,
    totalAccelerationDays: 0,
  };
}

