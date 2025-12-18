import {
  BiologicalAgeState,
  DailyMetrics,
  DailyAgeEntry,
  createInitialBiologicalAgeState,
  applyDailyAgeUpdate,
} from './ageModel';

interface UserProfile {
  chronologicalAgeYears: number;
  baselineBiologicalAgeYears: number;
  createdAt: string;
  updatedAt: string;
}

interface UserState {
  currentBiologicalAgeYears: number;
  agingDebtYears: number;
  rejuvenationStreakDays: number;
  accelerationStreakDays: number;
  totalRejuvenationDays: number;
  totalAccelerationDays: number;
  updatedAt: string;
}

interface DailyDocument {
  date: string;
  metrics: DailyMetrics;
  deltaYears: number;
  reasons: string[];
  biologicalAgeAfter: number;
  agingDebtAfter: number;
  createdAt: string;
}

// In-memory stores
const profileStore = new Map<string, UserProfile>();
const stateStore = new Map<string, UserState>();
const dailyStore = new Map<string, DailyDocument[]>(); // userId -> DailyDocument[]

/**
 * Gets or creates user profile.
 */
function getOrCreateUserProfile(
  userId: string,
  chronologicalAgeYears: number
): UserProfile {
  const existing = profileStore.get(userId);
  if (existing) {
    return existing;
  }

  const now = new Date().toISOString();
  const profile: UserProfile = {
    chronologicalAgeYears,
    baselineBiologicalAgeYears: chronologicalAgeYears,
    createdAt: now,
    updatedAt: now,
  };

  profileStore.set(userId, profile);
  return profile;
}

/**
 * Gets user profile.
 */
export function getUserProfile(
  userId: string
): UserProfile | null {
  return profileStore.get(userId) || null;
}

/**
 * Gets current user state.
 */
export function getUserState(userId: string): UserState | null {
  return stateStore.get(userId) || null;
}

/**
 * Gets or creates biological age state (for backward compatibility).
 */
export function getOrCreateBiologicalAgeState(
  userId: string,
  chronologicalAgeYears: number
): BiologicalAgeState {
  const profile = getOrCreateUserProfile(userId, chronologicalAgeYears);
  const state = getUserState(userId);

  if (state) {
    return {
      chronologicalAgeYears: profile.chronologicalAgeYears,
      baselineBiologicalAgeYears: profile.baselineBiologicalAgeYears,
      currentBiologicalAgeYears: state.currentBiologicalAgeYears,
      agingDebtYears: state.agingDebtYears,
      history: [],
      rejuvenationStreakDays: state.rejuvenationStreakDays,
      accelerationStreakDays: state.accelerationStreakDays,
      totalRejuvenationDays: state.totalRejuvenationDays,
      totalAccelerationDays: state.totalAccelerationDays,
    };
  }

  // Create initial state
  const initialState = createInitialBiologicalAgeState(chronologicalAgeYears);
  stateStore.set(userId, {
    currentBiologicalAgeYears: initialState.currentBiologicalAgeYears,
    agingDebtYears: initialState.agingDebtYears,
    rejuvenationStreakDays: initialState.rejuvenationStreakDays,
    accelerationStreakDays: initialState.accelerationStreakDays,
    totalRejuvenationDays: initialState.totalRejuvenationDays,
    totalAccelerationDays: initialState.totalAccelerationDays,
    updatedAt: new Date().toISOString(),
  });

  return initialState;
}

/**
 * Applies daily metrics and persists to memory.
 */
export function applyDailyMetricsForUser(
  userId: string,
  chronologicalAgeYears: number,
  metrics: DailyMetrics
): { next: BiologicalAgeState; entry: DailyAgeEntry } {
  // Get or create profile
  const profile = getOrCreateUserProfile(userId, chronologicalAgeYears);
  
  // Update profile if chronologicalAgeYears is provided and different
  if (chronologicalAgeYears !== profile.chronologicalAgeYears) {
    profile.chronologicalAgeYears = chronologicalAgeYears;
    profile.updatedAt = new Date().toISOString();
    profileStore.set(userId, profile);
  }

  // Get current state or create initial
  const currentState = getUserState(userId);
  const prevState: BiologicalAgeState = currentState
    ? {
        chronologicalAgeYears: profile.chronologicalAgeYears,
        baselineBiologicalAgeYears: profile.baselineBiologicalAgeYears,
        currentBiologicalAgeYears: currentState.currentBiologicalAgeYears,
        agingDebtYears: currentState.agingDebtYears,
        history: [],
        rejuvenationStreakDays: currentState.rejuvenationStreakDays,
        accelerationStreakDays: currentState.accelerationStreakDays,
        totalRejuvenationDays: currentState.totalRejuvenationDays,
        totalAccelerationDays: currentState.totalAccelerationDays,
      }
    : createInitialBiologicalAgeState(profile.chronologicalAgeYears);

  // Apply daily update
  const { next, entry } = applyDailyAgeUpdate(prevState, metrics);

  // Save state
  stateStore.set(userId, {
    currentBiologicalAgeYears: next.currentBiologicalAgeYears,
    agingDebtYears: next.agingDebtYears,
    rejuvenationStreakDays: next.rejuvenationStreakDays,
    accelerationStreakDays: next.accelerationStreakDays,
    totalRejuvenationDays: next.totalRejuvenationDays,
    totalAccelerationDays: next.totalAccelerationDays,
    updatedAt: new Date().toISOString(),
  });

  // Save daily entry
  const userDailyEntries = dailyStore.get(userId) || [];
  const dailyEntry: DailyDocument = {
    date: metrics.date,
    metrics,
    deltaYears: entry.deltaYears,
    reasons: entry.reasons,
    biologicalAgeAfter: next.currentBiologicalAgeYears,
    agingDebtAfter: next.agingDebtYears,
    createdAt: new Date().toISOString(),
  };
  
  // Remove existing entry for same date if exists
  const filtered = userDailyEntries.filter(e => e.date !== metrics.date);
  filtered.push(dailyEntry);
  // Sort by date descending
  filtered.sort((a, b) => b.date.localeCompare(a.date));
  dailyStore.set(userId, filtered);

  return { next, entry };
}

/**
 * Gets biological age state.
 */
export function getBiologicalAgeState(
  userId: string
): BiologicalAgeState | null {
  const profile = getUserProfile(userId);
  if (!profile) {
    return null;
  }

  const state = getUserState(userId);
  if (!state) {
    return null;
  }

  return {
    chronologicalAgeYears: profile.chronologicalAgeYears,
    baselineBiologicalAgeYears: profile.baselineBiologicalAgeYears,
    currentBiologicalAgeYears: state.currentBiologicalAgeYears,
    agingDebtYears: state.agingDebtYears,
    history: [],
    rejuvenationStreakDays: state.rejuvenationStreakDays,
    accelerationStreakDays: state.accelerationStreakDays,
    totalRejuvenationDays: state.totalRejuvenationDays,
    totalAccelerationDays: state.totalAccelerationDays,
  };
}

/**
 * Gets user's chronological age.
 */
export function getUserChronologicalAge(
  userId: string
): number | null {
  const profile = getUserProfile(userId);
  return profile ? profile.chronologicalAgeYears : null;
}

/**
 * Gets daily entries for trend calculation.
 */
export function getDailyEntries(
  userId: string,
  limit: number
): DailyDocument[] {
  const userDailyEntries = dailyStore.get(userId) || [];
  return userDailyEntries.slice(0, limit);
}
