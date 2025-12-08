import {
  BiologicalAgeState,
  DailyMetrics,
  DailyAgeEntry,
  createInitialBiologicalAgeState,
  applyDailyAgeUpdate,
} from './ageModel';

const ageStore = new Map<string, BiologicalAgeState>();

export function getOrCreateBiologicalAgeState(
  userId: string,
  chronologicalAgeYears: number
): BiologicalAgeState {
  const existing = ageStore.get(userId);
  if (existing) {
    return existing;
  }

  const initialState = createInitialBiologicalAgeState(chronologicalAgeYears);
  ageStore.set(userId, initialState);
  return initialState;
}

export function applyDailyMetricsForUser(
  userId: string,
  chronologicalAgeYears: number,
  metrics: DailyMetrics
): { next: BiologicalAgeState; entry: DailyAgeEntry } {
  const prevState = getOrCreateBiologicalAgeState(userId, chronologicalAgeYears);
  const { next, entry } = applyDailyAgeUpdate(prevState, metrics);
  ageStore.set(userId, next);
  return { next, entry };
}

export function getBiologicalAgeState(userId: string): BiologicalAgeState | null {
  const state = ageStore.get(userId);
  return state || null;
}

