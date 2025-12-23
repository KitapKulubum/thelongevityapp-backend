/**
 * Unit tests for Longevity Scoring Engine
 * Run with: npx ts-node src/longevity/longevityScoring.test.ts
 */

import {
  calculateOnboardingResult,
  calculateDailyResult,
  validateOnboardingAnswers,
  validateDailyAnswers,
  MAX_OFFSET_YEARS,
  MAX_DAILY_DAYS,
} from './longevityScoring';
import { OnboardingAnswers, DailyAnswers } from './longevityModel';

// Test helper
function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`TEST FAILED: ${message}`);
  }
  console.log(`✓ ${message}`);
}

// Test 1: Onboarding totalScore boundaries
function testOnboardingBoundaries() {
  console.log('\n=== Test 1: Onboarding totalScore boundaries ===');
  
  // All -1 (worst case)
  const worstAnswers: OnboardingAnswers = {
    sleep: -1,
    activity: -1,
    muscle: -1,
    visceralFat: -1,
    nutritionPattern: -1,
    sugar: -1,
    stress: -1,
    smokingAlcohol: -1,
    metabolicHealth: -1,
    energyFocus: -1,
  };
  
  const worstResult = calculateOnboardingResult(worstAnswers, 30);
  assert(worstResult.totalScore >= -1 && worstResult.totalScore <= 1, 
    `Worst case totalScore should be clamped: ${worstResult.totalScore}`);
  assert(worstResult.BAOYears >= -MAX_OFFSET_YEARS && worstResult.BAOYears <= MAX_OFFSET_YEARS,
    `Worst case BAOYears should be clamped: ${worstResult.BAOYears}`);
  
  // All +1 (best case)
  const bestAnswers: OnboardingAnswers = {
    sleep: 1,
    activity: 1,
    muscle: 1,
    visceralFat: 1,
    nutritionPattern: 1,
    sugar: 1,
    stress: 1,
    smokingAlcohol: 1,
    metabolicHealth: 1,
    energyFocus: 1,
  };
  
  const bestResult = calculateOnboardingResult(bestAnswers, 30);
  assert(bestResult.totalScore >= -1 && bestResult.totalScore <= 1,
    `Best case totalScore should be clamped: ${bestResult.totalScore}`);
  assert(bestResult.BAOYears >= -MAX_OFFSET_YEARS && bestResult.BAOYears <= MAX_OFFSET_YEARS,
    `Best case BAOYears should be clamped: ${bestResult.BAOYears}`);
  
  // Aging speed labels
  const rejuvenatingAnswers: OnboardingAnswers = {
    sleep: 1,
    activity: 1,
    muscle: 0.5,
    visceralFat: 0.5,
    nutritionPattern: 1,
    sugar: 0.5,
    stress: 0.5,
    smokingAlcohol: 1,
    metabolicHealth: 0.5,
    energyFocus: 0.5,
  };
  
  const rejResult = calculateOnboardingResult(rejuvenatingAnswers, 30);
  assert(rejResult.agingSpeedLabel === 'rejuvenating' || rejResult.totalScore >= 0.25,
    `Rejuvenating label test: ${rejResult.agingSpeedLabel}, score: ${rejResult.totalScore}`);
}

// Test 2: Daily EMA calculation
function testDailyEMA() {
  console.log('\n=== Test 2: Daily EMA calculation ===');
  
  const answers: DailyAnswers = {
    sleep: 0.5,
    movement: 0.5,
    foodQuality: 0,
    sugar: 0,
    stress: 0.5,
    mentalLoad: 0,
    moodSocial: 0.5,
    bodyFeel: 0,
    inflammationSignal: 0,
    selfCare: 0.5,
  };
  
  // First day (no previous EMA)
  const day1 = calculateDailyResult(answers, null, null);
  assert(day1.ema7 === day1.dailyAgingDays, 
    `First day EMA7 should equal dailyAgingDays: ${day1.ema7} === ${day1.dailyAgingDays}`);
  assert(day1.ema30 === day1.dailyAgingDays,
    `First day EMA30 should equal dailyAgingDays: ${day1.ema30} === ${day1.dailyAgingDays}`);
  
  // Second day (with previous EMA)
  const day2 = calculateDailyResult(answers, day1.ema7, day1.ema30);
  assert(day2.ema7 !== day2.dailyAgingDays,
    `Second day EMA7 should be smoothed: ${day2.ema7} !== ${day2.dailyAgingDays}`);
  assert(day2.ema30 !== day2.dailyAgingDays,
    `Second day EMA30 should be smoothed: ${day2.ema30} !== ${day2.dailyAgingDays}`);
  
  // Daily aging days should be clamped
  assert(day1.dailyAgingDays >= -MAX_DAILY_DAYS && day1.dailyAgingDays <= MAX_DAILY_DAYS,
    `Daily aging days should be clamped: ${day1.dailyAgingDays}`);
}

// Test 3: Trend label thresholds
function testTrendLabels() {
  console.log('\n=== Test 3: Trend label thresholds ===');
  
  const answers: DailyAnswers = {
    sleep: 0,
    movement: 0,
    foodQuality: 0,
    sugar: 0,
    stress: 0,
    mentalLoad: 0,
    moodSocial: 0,
    bodyFeel: 0,
    inflammationSignal: 0,
    selfCare: 0,
  };
  
  // Rejuvenating trend (EMA7 < -0.10)
  const rejResult = calculateDailyResult(answers, -0.15, -0.15);
  assert(rejResult.trendLabel === 'rejuvenating',
    `Rejuvenating trend label: ${rejResult.trendLabel}, EMA7: ${rejResult.ema7}`);
  
  // Accelerated trend (EMA7 > +0.10)
  const accResult = calculateDailyResult(answers, 0.15, 0.15);
  assert(accResult.trendLabel === 'accelerated',
    `Accelerated trend label: ${accResult.trendLabel}, EMA7: ${accResult.ema7}`);
  
  // Stable trend (-0.10 <= EMA7 <= +0.10)
  const stableResult = calculateDailyResult(answers, 0.05, 0.05);
  assert(stableResult.trendLabel === 'stable',
    `Stable trend label: ${stableResult.trendLabel}, EMA7: ${stableResult.ema7}`);
}

// Test 4: Validation
function testValidation() {
  console.log('\n=== Test 4: Answer validation ===');
  
  const validAnswers: OnboardingAnswers = {
    sleep: 0.5,
    activity: -0.5,
    muscle: 0,
    visceralFat: 1,
    nutritionPattern: -1,
    sugar: 0.5,
    stress: 0,
    smokingAlcohol: 0.5,
    metabolicHealth: -0.5,
    energyFocus: 1,
  };
  
  assert(validateOnboardingAnswers(validAnswers), 'Valid onboarding answers should pass');
  
  const invalidAnswers: any = {
    sleep: 2, // Invalid value
    activity: -0.5,
    muscle: 0,
    visceralFat: 1,
    nutritionPattern: -1,
    sugar: 0.5,
    stress: 0,
    smokingAlcohol: 0.5,
    metabolicHealth: -0.5,
    energyFocus: 1,
  };
  
  assert(!validateOnboardingAnswers(invalidAnswers), 'Invalid onboarding answers should fail');
  
  const validDaily: DailyAnswers = {
    sleep: 0.5,
    movement: -0.5,
    foodQuality: 0,
    sugar: 1,
    stress: -1,
    mentalLoad: 0.5,
    moodSocial: 0,
    bodyFeel: -0.5,
    inflammationSignal: 1,
    selfCare: 0.5,
  };
  
  assert(validateDailyAnswers(validDaily), 'Valid daily answers should pass');
}

// Run all tests
function runTests() {
  console.log('🧪 Running Longevity Scoring Engine Tests\n');
  
  try {
    testOnboardingBoundaries();
    testDailyEMA();
    testTrendLabels();
    testValidation();
    
    console.log('\n✅ All tests passed!');
  } catch (error: any) {
    console.error('\n❌ Test suite failed:', error.message);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  runTests();
}

export { runTests };

