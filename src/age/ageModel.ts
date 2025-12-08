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
  score: number; // -10 to +10
  deltaYears: number; // daily biological age change in years
  reasons: string[]; // brief explanations for the score
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
  reasons: string[];
} {
  let score = 0;
  const reasons: string[] = [];

  // Sleep hours
  if (metrics.sleepHours >= 7 && metrics.sleepHours <= 9) {
    score += 3;
    reasons.push('Optimal sleep duration');
  } else if (
    (metrics.sleepHours >= 6 && metrics.sleepHours < 7) ||
    (metrics.sleepHours > 9 && metrics.sleepHours <= 10)
  ) {
    score += 1;
  } else if (
    (metrics.sleepHours >= 5 && metrics.sleepHours < 6) ||
    metrics.sleepHours > 10
  ) {
    score -= 1;
  } else if (metrics.sleepHours < 5) {
    score -= 3;
    reasons.push('Severe sleep restriction');
  }

  // Movement (steps + vigorousMinutes)
  if (metrics.steps >= 8000 || metrics.vigorousMinutes >= 30) {
    score += 3;
  } else if (
    (metrics.steps >= 5000 && metrics.steps < 8000) ||
    (metrics.vigorousMinutes >= 10 && metrics.vigorousMinutes < 30)
  ) {
    score += 1;
  } else if (metrics.steps >= 3000 && metrics.steps < 5000) {
    // 0 points, no change
  } else if (metrics.steps < 3000 && metrics.vigorousMinutes < 10) {
    score -= 2;
  }

  // Processed food (0–10, 10 = worst)
  if (metrics.processedFoodScore >= 0 && metrics.processedFoodScore <= 2) {
    score += 2;
  } else if (metrics.processedFoodScore >= 3 && metrics.processedFoodScore <= 5) {
    score += 1;
  } else if (metrics.processedFoodScore >= 6 && metrics.processedFoodScore <= 8) {
    score -= 1;
  } else if (metrics.processedFoodScore >= 9 && metrics.processedFoodScore <= 10) {
    score -= 2;
  }

  // Alcohol
  if (metrics.alcoholUnits === 0) {
    score += 1;
  } else if (metrics.alcoholUnits >= 1 && metrics.alcoholUnits <= 2) {
    // 0 points, no change
  } else if (metrics.alcoholUnits >= 3) {
    score -= 2;
  }

  // Stress level (1–10, 10 = very stressed)
  if (metrics.stressLevel >= 1 && metrics.stressLevel <= 3) {
    score += 2;
  } else if (metrics.stressLevel >= 4 && metrics.stressLevel <= 6) {
    // 0 points, no change
  } else if (metrics.stressLevel >= 7 && metrics.stressLevel <= 8) {
    score -= 1;
  } else if (metrics.stressLevel >= 9 && metrics.stressLevel <= 10) {
    score -= 2;
  }

  // Late caffeine
  if (metrics.lateCaffeine) {
    score -= 1;
  }

  // Late screen
  if (metrics.screenLate) {
    score -= 1;
  }

  // Bedtime hour
  if (metrics.bedtimeHour >= 21 && metrics.bedtimeHour < 23) {
    score += 2;
  } else if (metrics.bedtimeHour >= 23 && metrics.bedtimeHour < 24) {
    // 0 points, no change
  } else if (metrics.bedtimeHour >= 0 && metrics.bedtimeHour <= 1) {
    score -= 1;
  } else if (metrics.bedtimeHour > 1 && metrics.bedtimeHour < 21) {
    // Assuming this means after 1am but before 9pm (next day)
    score -= 2;
  }

  // Clamp score between -10 and +10
  if (score > 10) score = 10;
  if (score < -10) score = -10;

  return { score, reasons };
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
  const { score, reasons } = calculateDailyScore(metrics);

  // Convert score to biological age delta in years
  // Positive score (good habits) reduces biological age (rejuvenation)
  // Negative score (bad habits) increases biological age (accelerated aging)
  // -10 to +10 score maps to +0.02 to -0.02 years per day
  const deltaYears = -score * 0.002;

  // Compute new current biological age
  const currentBiologicalAgeYears =
    prev.currentBiologicalAgeYears + deltaYears;

  // Compute new aging debt (only positive difference from chronological age)
  const agingDebtYears = Math.max(
    0,
    currentBiologicalAgeYears - prev.chronologicalAgeYears
  );

  // Update streaks and counters based on deltaYears
  let rejuvenationStreakDays = prev.rejuvenationStreakDays;
  let accelerationStreakDays = prev.accelerationStreakDays;
  let totalRejuvenationDays = prev.totalRejuvenationDays;
  let totalAccelerationDays = prev.totalAccelerationDays;

  if (deltaYears < 0) {
    // Rejuvenation day (biological age decreased)
    rejuvenationStreakDays = prev.rejuvenationStreakDays + 1;
    accelerationStreakDays = 0;
    totalRejuvenationDays = prev.totalRejuvenationDays + 1;
    totalAccelerationDays = prev.totalAccelerationDays;
  } else if (deltaYears > 0) {
    // Accelerated aging day (biological age increased)
    accelerationStreakDays = prev.accelerationStreakDays + 1;
    rejuvenationStreakDays = 0;
    totalAccelerationDays = prev.totalAccelerationDays + 1;
    totalRejuvenationDays = prev.totalRejuvenationDays;
  }
  // If deltaYears === 0, keep both streaks and totals as they were

  // Build daily entry
  const entry: DailyAgeEntry = {
    date: metrics.date,
    score,
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

