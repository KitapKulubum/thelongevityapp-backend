/**
 * Health score model for tracking baseline and current scores
 * across sleep, activity, nutrition, stress, and risk factors.
 */

export interface OnboardingAnswers {
  sleepHours: number;
  sleepRegularity: 'irregular' | 'sometimes' | 'regular';
  exerciseDays: number; // per week
  stepsAvg: number;
  strengthDays: number; // per week
  cardioDays: number; // per week
  processedFoodDays: number; // per week
  vegServings: number; // per day
  sugaryDrinksPerWeek: number;
  alcoholUnitsPerWeek: number;
  stressLevel: number; // 1-10
  meditation: 'never' | 'sometimes' | 'regular';
  smoking: boolean;
}

export interface ScoreBreakdown {
  sleep: number; // 0-20
  activity: number; // 0-20
  nutrition: number; // 0-20
  stress: number; // 0-20
  risk: number; // 0-20
}

export interface ScoreState {
  userId: string;
  baselineScore: number; // 0-100
  currentScore: number; // 0-100
  breakdown: ScoreBreakdown;
  insights: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Calculates health score breakdown from onboarding answers.
 * Each category is scored 0-20, total 0-100.
 */
export function calculateOnboardingScore(
  answers: OnboardingAnswers
): { score: number; breakdown: ScoreBreakdown; insights: string[] } {
  const breakdown: ScoreBreakdown = {
    sleep: 0,
    activity: 0,
    nutrition: 0,
    stress: 0,
    risk: 0,
  };
  const insights: string[] = [];

  // Sleep (0-20)
  // Hours: 7-9h = 10pts, 6-7h or 9-10h = 7pts, <6h or >10h = 3pts
  if (answers.sleepHours >= 7 && answers.sleepHours <= 9) {
    breakdown.sleep += 10;
  } else if (
    (answers.sleepHours >= 6 && answers.sleepHours < 7) ||
    (answers.sleepHours > 9 && answers.sleepHours <= 10)
  ) {
    breakdown.sleep += 7;
  } else {
    breakdown.sleep += 3;
  }

  // Regularity: regular = 10pts, sometimes = 5pts, irregular = 0pts
  if (answers.sleepRegularity === 'regular') {
    breakdown.sleep += 10;
  } else if (answers.sleepRegularity === 'sometimes') {
    breakdown.sleep += 5;
  }

  if (breakdown.sleep < 15) {
    insights.push('Sleep consistency is your biggest lever');
  }

  // Activity (0-20)
  // Steps: >=8000 = 7pts, 5000-7999 = 5pts, <5000 = 2pts
  if (answers.stepsAvg >= 8000) {
    breakdown.activity += 7;
  } else if (answers.stepsAvg >= 5000) {
    breakdown.activity += 5;
  } else {
    breakdown.activity += 2;
  }

  // Exercise days: >=5 = 7pts, 3-4 = 5pts, 1-2 = 3pts, 0 = 0pts
  const totalExerciseDays = answers.exerciseDays;
  if (totalExerciseDays >= 5) {
    breakdown.activity += 7;
  } else if (totalExerciseDays >= 3) {
    breakdown.activity += 5;
  } else if (totalExerciseDays >= 1) {
    breakdown.activity += 3;
  }

  // Strength + Cardio balance: both >=2 = 6pts, one >=2 = 3pts, neither = 0pts
  if (answers.strengthDays >= 2 && answers.cardioDays >= 2) {
    breakdown.activity += 6;
  } else if (answers.strengthDays >= 2 || answers.cardioDays >= 2) {
    breakdown.activity += 3;
  }

  // Nutrition (0-20)
  // Processed food: 0-1 days = 8pts, 2-3 = 5pts, 4-5 = 2pts, 6+ = 0pts
  if (answers.processedFoodDays <= 1) {
    breakdown.nutrition += 8;
  } else if (answers.processedFoodDays <= 3) {
    breakdown.nutrition += 5;
  } else if (answers.processedFoodDays <= 5) {
    breakdown.nutrition += 2;
  }

  // Veg servings: >=5 = 7pts, 3-4 = 5pts, 1-2 = 3pts, 0 = 0pts
  if (answers.vegServings >= 5) {
    breakdown.nutrition += 7;
  } else if (answers.vegServings >= 3) {
    breakdown.nutrition += 5;
  } else if (answers.vegServings >= 1) {
    breakdown.nutrition += 3;
  }

  // Sugary drinks: 0 = 5pts, 1-3 = 3pts, 4-7 = 1pt, 8+ = 0pts
  if (answers.sugaryDrinksPerWeek === 0) {
    breakdown.nutrition += 5;
  } else if (answers.sugaryDrinksPerWeek <= 3) {
    breakdown.nutrition += 3;
  } else if (answers.sugaryDrinksPerWeek <= 7) {
    breakdown.nutrition += 1;
  }

  // Stress (0-20)
  // Stress level: 1-3 = 10pts, 4-6 = 6pts, 7-8 = 3pts, 9-10 = 0pts
  if (answers.stressLevel <= 3) {
    breakdown.stress += 10;
  } else if (answers.stressLevel <= 6) {
    breakdown.stress += 6;
  } else if (answers.stressLevel <= 8) {
    breakdown.stress += 3;
  }

  // Meditation: regular = 10pts, sometimes = 5pts, never = 0pts
  if (answers.meditation === 'regular') {
    breakdown.stress += 10;
  } else if (answers.meditation === 'sometimes') {
    breakdown.stress += 5;
  }

  // Risk (0-20)
  // Smoking: false = 10pts, true = 0pts
  if (!answers.smoking) {
    breakdown.risk += 10;
  } else {
    insights.push('Quitting smoking would significantly improve your score');
  }

  // Alcohol: 0-2 units/week = 10pts, 3-7 = 7pts, 8-14 = 4pts, 15+ = 0pts
  if (answers.alcoholUnitsPerWeek <= 2) {
    breakdown.risk += 10;
  } else if (answers.alcoholUnitsPerWeek <= 7) {
    breakdown.risk += 7;
  } else if (answers.alcoholUnitsPerWeek <= 14) {
    breakdown.risk += 4;
  }

  // Clamp each category to 0-20
  breakdown.sleep = Math.max(0, Math.min(20, breakdown.sleep));
  breakdown.activity = Math.max(0, Math.min(20, breakdown.activity));
  breakdown.nutrition = Math.max(0, Math.min(20, breakdown.nutrition));
  breakdown.stress = Math.max(0, Math.min(20, breakdown.stress));
  breakdown.risk = Math.max(0, Math.min(20, breakdown.risk));

  const score =
    breakdown.sleep +
    breakdown.activity +
    breakdown.nutrition +
    breakdown.stress +
    breakdown.risk;

  // Add generic insights if score is low
  if (score < 60) {
    insights.push('Focus on one category at a time for sustainable improvement');
  }

  return { score, breakdown, insights };
}

/**
 * Updates current score based on daily metrics.
 * For now, this is a simplified version that adjusts based on daily check-in.
 * In a full implementation, this would track trends over time.
 */
export function updateDailyScore(
  prevState: ScoreState,
  dailyMetrics: {
    sleepHours?: number;
    steps?: number;
    vigorousMinutes?: number;
    stressLevel?: number;
    processedFoodScore?: number;
    alcoholUnits?: number;
  }
): ScoreState {
  // Simple adjustment: if daily metrics are better than baseline assumptions,
  // slightly increase score; if worse, slightly decrease.
  // This is a placeholder - a full implementation would track rolling averages.

  let adjustment = 0;
  const newBreakdown = { ...prevState.breakdown };

  // Sleep adjustment (if provided)
  if (dailyMetrics.sleepHours !== undefined) {
    if (dailyMetrics.sleepHours >= 7 && dailyMetrics.sleepHours <= 9) {
      adjustment += 0.5;
    } else if (dailyMetrics.sleepHours < 6 || dailyMetrics.sleepHours > 10) {
      adjustment -= 0.5;
    }
  }

  // Steps adjustment
  if (dailyMetrics.steps !== undefined) {
    if (dailyMetrics.steps >= 8000) {
      adjustment += 0.3;
    } else if (dailyMetrics.steps < 5000) {
      adjustment -= 0.3;
    }
  }

  // Stress adjustment
  if (dailyMetrics.stressLevel !== undefined) {
    if (dailyMetrics.stressLevel <= 3) {
      adjustment += 0.2;
    } else if (dailyMetrics.stressLevel >= 7) {
      adjustment -= 0.2;
    }
  }

  // Clamp current score between 0-100
  const newCurrentScore = Math.max(
    0,
    Math.min(100, prevState.baselineScore + adjustment)
  );

  return {
    ...prevState,
    currentScore: newCurrentScore,
    updatedAt: new Date().toISOString(),
  };
}

