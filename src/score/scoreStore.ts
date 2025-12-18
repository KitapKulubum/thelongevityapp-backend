import {
  ScoreState,
  OnboardingAnswers,
  calculateOnboardingScore,
  updateDailyScore,
} from './scoreModel';
import { DailyMetrics } from '../age/ageModel';

// In-memory store
const scoreStore = new Map<string, ScoreState>();

/**
 * Creates or updates score state from onboarding answers.
 */
export function setOnboardingScore(
  userId: string,
  answers: OnboardingAnswers
): ScoreState {
  const { score, breakdown, insights } = calculateOnboardingScore(answers);
  const now = new Date().toISOString();

  const state: ScoreState = {
    userId,
    baselineScore: score,
    currentScore: score,
    breakdown,
    insights,
    createdAt: now,
    updatedAt: now,
  };

  scoreStore.set(userId, state);
  return state;
}

/**
 * Gets current score state for a user.
 */
export function getScoreState(
  userId: string
): ScoreState | null {
  return scoreStore.get(userId) || null;
}

/**
 * Updates score based on daily metrics.
 */
export function updateScoreFromDaily(
  userId: string,
  dailyMetrics: DailyMetrics
): ScoreState | null {
  const prevState = scoreStore.get(userId);
  if (!prevState) {
    return null;
  }

  const updated = updateDailyScore(prevState, {
    sleepHours: dailyMetrics.sleepHours,
    steps: dailyMetrics.steps,
    vigorousMinutes: dailyMetrics.vigorousMinutes,
    stressLevel: dailyMetrics.stressLevel,
    processedFoodScore: dailyMetrics.processedFoodScore,
    alcoholUnits: dailyMetrics.alcoholUnits,
  });

  scoreStore.set(userId, updated);
  return updated;
}
