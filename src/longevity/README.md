# Longevity Scoring Engine

Explainable longevity scoring system with Biological Age Offset (BAO) and Daily Aging Velocity (DAV) calculations.

## Overview

This engine provides:
1. **Onboarding Baseline** → Calculates BAO (Biological Age Offset in years)
2. **Daily Check-ins** → Calculates DAV (Daily Aging Velocity in days) + EMA trends
3. **Firestore Storage** → Stores raw answers and computed scores
4. **API Endpoints** → RESTful endpoints for iOS app integration

## Data Models

### Onboarding Answers
10 questions with values: `-1 | -0.5 | 0 | 0.5 | 1`

- `sleep` - Sleep quality
- `activity` - Physical activity level
- `muscle` - Muscle mass/strength
- `visceralFat` - Visceral fat level
- `nutritionPattern` - Overall nutrition quality
- `sugar` - Sugar consumption
- `stress` - Stress levels
- `smokingAlcohol` - Smoking/alcohol habits
- `metabolicHealth` - Metabolic markers
- `energyFocus` - Energy and focus levels

### Daily Answers
10 questions with same value range

- `sleep` - Sleep quality today
- `movement` - Movement/physical activity
- `foodQuality` - Food quality
- `sugar` - Sugar exposure
- `stress` - Stress level
- `mentalLoad` - Mental/emotional load
- `moodSocial` - Mood and social connection
- `bodyFeel` - Body sensations
- `inflammationSignal` - Inflammation signals
- `selfCare` - Self-care practices

## Scoring Logic

### Onboarding System Weights
- Sleep: 22%
- Movement: 25%
- Metabolic: 25%
- Nutrition: 15%
- Stress: 13%

### Daily System Weights
- Sleep: 20%
- Movement: 25%
- Nutrition: 20%
- Stress/Mind: 20%
- Body/Inflammation: 15%

### Calculations

**Onboarding:**
- System scores = average(grouped answers) × weight
- Total score = sum(system scores), clamped to [-1, 1]
- BAO Years = totalScore × 8, clamped to [-8, +8]
- Biological Age = Chronological Age + BAO Years

**Daily:**
- Daily score = sum(system scores), clamped to [-1, 1]
- Daily Aging Days = dailyScore × 0.4, clamped to [-0.4, +0.4]
- EMA7 and EMA30 calculated using exponential moving average

## API Endpoints

### POST /api/onboarding/submit
Submit onboarding answers and calculate BAO.

**Request:**
```json
{
  "userId": "user123",
  "chronologicalAge": 35,
  "answers": {
    "sleep": 0.5,
    "activity": 0.5,
    "muscle": 0,
    "visceralFat": -0.5,
    "nutritionPattern": 0.5,
    "sugar": -0.5,
    "stress": 0,
    "smokingAlcohol": 1,
    "metabolicHealth": 0,
    "energyFocus": 0.5
  }
}
```

**Response:**
```json
{
  "totalScore": 0.15,
  "BAOYears": 1.2,
  "biologicalAge": 36.2,
  "agingSpeedLabel": "normal",
  "systemScores": {
    "sleep": 0.11,
    "movement": 0.125,
    "metabolic": -0.083,
    "nutrition": 0.075,
    "stress": 0.05
  },
  "topRiskSystems": ["metabolic", "stress"]
}
```

### POST /api/daily/submit
Submit daily check-in and calculate DAV + EMA trends.

**Request:**
```json
{
  "userId": "user123",
  "date": "2025-12-19",
  "answers": {
    "sleep": 0.5,
    "movement": 0.5,
    "foodQuality": 0,
    "sugar": 0,
    "stress": 0.5,
    "mentalLoad": 0,
    "moodSocial": 0.5,
    "bodyFeel": 0,
    "inflammationSignal": 0,
    "selfCare": 0.5
  }
}
```

**Response:**
```json
{
  "dailyScore": 0.2,
  "dailyAgingDays": 0.08,
  "ema7": 0.05,
  "ema30": 0.03,
  "trendLabel": "stable"
}
```

### GET /api/stats/summary?userId=user123
Get summary statistics.

**Response:**
```json
{
  "biologicalAge": 36.2,
  "BAOYears": 1.2,
  "ema7": 0.05,
  "ema30": 0.03,
  "trendLabel": "stable",
  "topRiskSystems": ["metabolic", "stress"]
}
```

## Firestore Structure

```
/users/{userId}
  /profile/main
    - chronologicalAge
    - updatedAt

  /onboarding/{docId}
    - createdAt
    - updatedAt
    - answers: OnboardingAnswers
    - result: OnboardingResult

  /daily/{YYYY-MM-DD}
    - date
    - createdAt
    - updatedAt
    - answers: DailyAnswers
    - result: DailyResult

  /stats/current
    - lastEma7
    - lastEma30
    - lastBiologicalAge (optional)
    - lastUpdatedAt
```

## Validation & Guardrails

- All answer values must be in `[-1, -0.5, 0, 0.5, 1]`
- Total scores clamped to `[-1, 1]`
- BAO Years clamped to `[-8, +8]`
- Daily Aging Days clamped to `[-0.4, +0.4]`
- One daily entry per date (overwrites if exists)
- Date format must be `YYYY-MM-DD`

## Running Tests

```bash
npx ts-node src/longevity/longevityScoring.test.ts
```

Tests cover:
- Onboarding totalScore boundaries
- Daily EMA calculation
- Trend label thresholds
- Answer validation

