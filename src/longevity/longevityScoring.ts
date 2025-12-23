import { DailyMetrics, OnboardingAnswers } from './longevityModel';

// Constants
export const MAX_OFFSET_YEARS = 8; // onboarding BAO cap
export const AGE_FACTOR = MAX_OFFSET_YEARS; // mapping score -> BAO (years)
export const DAILY_MAX_DELTA_YEARS = 0.3; // clamp daily delta

/**
 * Clamps a value between min and max.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Compute onboarding totalScore and baseline biological age.
 * Positive totalScore => younger bio age (negative BAOYears).
 */
export function calculateOnboardingResult(
  answers: OnboardingAnswers,
  chronologicalAgeYears: number
): { totalScore: number; BAOYears: number; baselineBiologicalAgeYears: number } {
  // Simple weighted sum keeping the same proportions as earlier logic.
  const weights = {
    sleep: 0.22,
    movement: 0.25,
    metabolic: 0.25,
    nutrition: 0.15,
    stress: 0.13,
  };

  const sleepScore = answers.sleep * weights.sleep;
  const movementScore = ((answers.activity + answers.muscle) / 2) * weights.movement;
  const metabolicScore =
    ((answers.visceralFat + answers.sugar + answers.metabolicHealth) / 3) * weights.metabolic;
  const nutritionScore = answers.nutritionPattern * weights.nutrition;
  const stressScore =
    ((answers.stress + answers.smokingAlcohol + answers.energyFocus) / 3) * weights.stress;

  const totalScore = clamp(
    sleepScore + movementScore + metabolicScore + nutritionScore + stressScore,
    -1,
    1
  );

  // Positive totalScore => negative BAOYears (younger biological age)
  const BAOYears = clamp(-totalScore * AGE_FACTOR, -MAX_OFFSET_YEARS, MAX_OFFSET_YEARS);
  const baselineBiologicalAgeYears = chronologicalAgeYears + BAOYears;

  return { totalScore, BAOYears, baselineBiologicalAgeYears };
}

/**
 * Compute daily score and deltaYears from daily metrics.
 * Positive score => rejuvenating => negative deltaYears.
 */
export function calculateDailyScore(
  metrics: DailyMetrics
): { score: number; deltaYears: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  // Sleep hours
  if (metrics.sleepHours >= 7 && metrics.sleepHours <= 9) {
    score += 2;
    reasons.push('Sleep: good duration');
  } else if (metrics.sleepHours < 6) {
    score -= 2;
    reasons.push('Sleep: too short');
  } else {
    score -= 0.5;
    reasons.push('Sleep: could be better');
  }

  // Steps
  if (metrics.steps >= 10000) {
    score += 2;
    reasons.push('Steps: active day');
  } else if (metrics.steps >= 7000) {
    score += 1;
    reasons.push('Steps: moderate');
  } else if (metrics.steps < 4000) {
    score -= 2;
    reasons.push('Steps: low activity');
  } else {
    score -= 1;
    reasons.push('Steps: below target');
  }

  // Vigorous minutes
  if (metrics.vigorousMinutes >= 30) {
    score += 1.5;
    reasons.push('Exercise: strong session');
  } else if (metrics.vigorousMinutes >= 10) {
    score += 0.5;
    reasons.push('Exercise: some intensity');
  } else {
    score -= 0.5;
    reasons.push('Exercise: add intensity');
  }

  // Processed food (lower is better, assume 1-5 scale)
  if (metrics.processedFoodScore <= 2) {
    score += 1;
    reasons.push('Food: minimally processed');
  } else if (metrics.processedFoodScore >= 4) {
    score -= 1.5;
    reasons.push('Food: too processed');
  } else {
    score -= 0.5;
    reasons.push('Food: mixed quality');
  }

  // Alcohol
  if (metrics.alcoholUnits === 0) {
    score += 1;
    reasons.push('Alcohol: none');
  } else if (metrics.alcoholUnits <= 2) {
    reasons.push('Alcohol: moderate');
  } else {
    score -= 1;
    reasons.push('Alcohol: high');
  }

  // Stress level (0-10 scale assumed; high is worse)
  if (metrics.stressLevel <= 3) {
    score += 1;
    reasons.push('Stress: low');
  } else if (metrics.stressLevel >= 7) {
    score -= 1.5;
    reasons.push('Stress: high');
  } else {
    score -= 0.5;
    reasons.push('Stress: moderate');
  }

  if (metrics.lateCaffeine) {
    score -= 1;
    reasons.push('Caffeine: late intake');
  }

  if (metrics.screenLate) {
    score -= 0.5;
    reasons.push('Screen time: late use');
  }

  if (metrics.bedtimeHour > 24 || metrics.bedtimeHour < 5) {
    score -= 1;
    reasons.push('Bedtime: very late');
  } else if (metrics.bedtimeHour > 23) {
    score -= 0.5;
    reasons.push('Bedtime: late');
  } else {
    score += 0.5;
    reasons.push('Bedtime: good timing');
  }

  // Map score to deltaYears (positive score => negative deltaYears)
  const deltaYears = clamp(-score * 0.03, -DAILY_MAX_DELTA_YEARS, DAILY_MAX_DELTA_YEARS);

  return { score, deltaYears, reasons };
}
