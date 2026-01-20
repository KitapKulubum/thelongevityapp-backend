/**
 * Simple heuristic-based biological age model for tracking daily health metrics
 * and estimating biological age changes over time.
 *
 * NOTE: This is a simplified educational model and should not be used as medical advice.
 */

export interface DailyMetrics {
  date: string; // ISO date, e.g. "2025-12-04"
  sleepQuality: number; // 0 (worst) – 4 (best)
  energyLevel: number; // 0–4
  physicalActivity: number; // 0–4
  nutritionQuality: number; // 0–4
  sugarAlcoholExposure: number; // 0 (high) – 3 (none)
  stressLevel: number; // 0 (extremely stressful) – 4 (calm)
  mentalEmotionalLoad: number; // 0 (overloaded) – 4 (mentally clear)
  circadianRhythm: number; // 0 (no daylight/late screen) – 4 (excellent)
  bodySignals: string[]; // ["Bloating", "Headache", "Muscle soreness", "None", "Great"]
  rejuvenationBehaviors: string[]; // ["Meditation", "Sauna", "Stretching", "Social", "None"]
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
  agingDebtYears: number; // currentBiological - chronological
  history: DailyAgeEntry[]; // recent days
  rejuvenationStreakDays: number; // consecutive days with negative deltaYears
  totalRejuvenationDays: number; // how many days had negative deltaYears
}

/**
 * Calculates a daily biological age delta based on 10 health signals.
 * Max daily change: +0.3 years (aging) to -0.2 years (rejuvenation).
 *
 * @param metrics - Daily health metrics
 * @returns Score (0-100 placeholder), deltaYears, and human-readable reasons
 */
export function calculateDailyScore(metrics: DailyMetrics): {
  score: number;
  deltaYears: number;
  reasons: string[];
} {
  let deltaYears = 0;
  const reasons: string[] = [];

  // Helper to map 5-option questions (0-4)
  const mapFiveOption = (val: number, label: string) => {
    switch (val) {
      case 0: deltaYears += 0.03; reasons.push(`${label}: Very poor`); break;
      case 1: deltaYears += 0.02; reasons.push(`${label}: Poor`); break;
      case 2: deltaYears += 0.01; reasons.push(`${label}: Moderate`); break;
      case 3: deltaYears -= 0.01; reasons.push(`${label}: Good`); break;
      case 4: deltaYears -= 0.02; reasons.push(`${label}: Excellent`); break;
    }
  };

  mapFiveOption(metrics.sleepQuality, 'Sleep');
  mapFiveOption(metrics.energyLevel, 'Energy');
  mapFiveOption(metrics.physicalActivity, 'Activity');
  mapFiveOption(metrics.nutritionQuality, 'Nutrition');
  mapFiveOption(metrics.stressLevel, 'Stress');
  mapFiveOption(metrics.mentalEmotionalLoad, 'Mental load');
  mapFiveOption(metrics.circadianRhythm, 'Circadian');

  // Sugar & Alcohol (0-3)
  switch (metrics.sugarAlcoholExposure) {
    case 0: deltaYears += 0.03; reasons.push('Sugar/Alcohol: High'); break;
    case 1: deltaYears += 0.01; reasons.push('Sugar/Alcohol: Moderate'); break;
    case 2: deltaYears -= 0.01; reasons.push('Sugar/Alcohol: Low'); break;
    case 3: deltaYears -= 0.02; reasons.push('Sugar/Alcohol: None'); break;
  }

  // Body Signals (Multi-select)
  if (metrics.bodySignals.includes('Great')) {
    deltaYears -= 0.02;
    reasons.push('Feeling physically great');
  } else if (metrics.bodySignals.includes('None')) {
    deltaYears -= 0.01;
    reasons.push('No physical discomfort');
  } else {
    let symptomsCount = 0;
    if (metrics.bodySignals.includes('Bloating')) symptomsCount++;
    if (metrics.bodySignals.includes('Headache')) symptomsCount++;
    if (metrics.bodySignals.includes('Muscle soreness')) symptomsCount++;
    
    if (symptomsCount > 0) {
      const load = Math.min(0.03, symptomsCount * 0.01);
      deltaYears += load;
      reasons.push(`Physical discomfort (${symptomsCount} signals)`);
    }
  }

  // Rejuvenation Behaviors (Multi-select)
  if (metrics.rejuvenationBehaviors.includes('None')) {
    deltaYears += 0.03;
    reasons.push('No intentional recovery');
  } else {
    const behaviorCount = metrics.rejuvenationBehaviors.filter(b => b !== 'None').length;
    if (behaviorCount >= 2) {
      deltaYears -= 0.02;
      reasons.push('Active recovery (2+ behaviors)');
    } else if (behaviorCount === 1) {
      deltaYears -= 0.01;
      reasons.push('Active recovery (1 behavior)');
  }
  }

  // Clamp results to user specified range
  deltaYears = Math.max(-0.20, Math.min(0.30, deltaYears));
  
  // Calculate a simplified score (0-100) based on where deltaYears falls in the -0.2 to +0.3 range
  // -0.2 -> 100, +0.3 -> 0
  const score = Math.round(((0.3 - deltaYears) / 0.5) * 100);

  return { score, deltaYears, reasons };
}

/**
 * Applies daily metrics to update the biological age state.
 */
export function applyDailyAgeUpdate(
  prev: BiologicalAgeState,
  metrics: DailyMetrics
): { next: BiologicalAgeState; entry: DailyAgeEntry } {
  const { deltaYears, reasons } = calculateDailyScore(metrics);

  const currentBiologicalAgeYears = prev.currentBiologicalAgeYears + deltaYears;
  const agingDebtYears = currentBiologicalAgeYears - prev.chronologicalAgeYears;

  const threshold = 0.001;
  let rejuvenationStreakDays = prev.rejuvenationStreakDays;
  let totalRejuvenationDays = prev.totalRejuvenationDays;

  if (deltaYears <= -threshold) {
    rejuvenationStreakDays += 1;
    totalRejuvenationDays += 1;
  } else {
    // Acceleration or neutral: reset streak
    rejuvenationStreakDays = 0;
  }

  const entry: DailyAgeEntry = {
    date: metrics.date,
    deltaYears,
    reasons,
  };

  const history = [...prev.history, entry].slice(-30);

  const next: BiologicalAgeState = {
    ...prev,
    currentBiologicalAgeYears,
    agingDebtYears,
    history,
    rejuvenationStreakDays,
    totalRejuvenationDays,
  };

  return { next, entry };
}

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
    totalRejuvenationDays: 0,
  };
}
