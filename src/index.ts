import express, { Express } from 'express';
import cors from 'cors';
import { ingestKnowledgeDir, ingestUserLog } from './rag/ingest';
import { longevityChat } from './rag/chat';
import { generateAgeMessage } from './age/ageMessages';
import {
  setOnboardingScore,
  getScoreState,
  updateScoreFromDaily,
} from './score/scoreStore';
import { OnboardingAnswers as ScoreOnboardingAnswers } from './score/scoreModel';
import {
  calculateOnboardingResult,
  calculateDailyScore,
  MAX_OFFSET_YEARS,
  AGE_FACTOR,
} from './longevity/longevityScoring';
import {
  upsertUserOnboarding,
  getUserDocument,
  saveDailyEntry,
  getDailyEntry,
  listDailyEntries,
  updateUserAfterDaily,
} from './longevity/longevityStore';
import {
  OnboardingSubmitRequest,
  OnboardingSubmitResponse,
  BiologicalAgeState,
  DailyMetrics,
  DailyUpdateResponse,
  HistoryPoint,
  TodayEntry,
  StatsSummaryResponse,
} from './longevity/longevityModel';
import { requireAuth, AuthenticatedRequest } from './auth/authMiddleware';
import { verifyIdToken, getOrCreateUserProfile } from './auth/firebaseAuth';
import { firestore } from './config/firestore';

const clampValue = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const app: Express = express();

app.use(cors());
app.use(express.json());

function normalizeDailyMetrics(body: any): DailyMetrics {
  const today = new Date().toISOString().slice(0, 10);
  const source = body.metrics ?? body;

  const num = (value: any, fallback = 0) =>
    Number.isFinite(Number(value)) ? Number(value) : fallback;
  const bool = (value: any) => Boolean(value);

  return {
    date: source.date ?? today,
    sleepHours: num(source.sleepHours),
    steps: num(source.steps),
    vigorousMinutes: num(source.vigorousMinutes),
    processedFoodScore: num(source.processedFoodScore),
    alcoholUnits: num(source.alcoholUnits),
    stressLevel: num(source.stressLevel),
    lateCaffeine: bool(source.lateCaffeine),
    screenLate: bool(source.screenLate),
    bedtimeHour: num(source.bedtimeHour),
  };
}

app.post('/api/chat', async (req, res) => {
  try {
    const { userId, message } = req.body;
    if (!userId || !message) {
      return res.status(400).json({ error: 'userId and message are required' });
    }
    const result = await longevityChat({ userId, message });
    return res.json(result);
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/ingest-log', async (req, res) => {
  try {
    const { userId, logText } = req.body;
    if (!userId || !logText) {
      return res.status(400).json({ error: 'userId and logText are required' });
    }
    await ingestUserLog(userId, logText);
    return res.json({ ok: true });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/auth/me
 * Verifies idToken and returns/creates Firestore user profile.
 */
app.post('/api/auth/me', async (req, res) => {
  try {
    const { idToken } = req.body || {};
    if (!idToken || typeof idToken !== 'string') {
      return res.status(400).json({ error: 'idToken is required' });
    }

    const decoded = await verifyIdToken(idToken);
    const profile = await getOrCreateUserProfile(decoded.uid, decoded.email);

    return res.json({
      uid: decoded.uid,
      email: decoded.email ?? null,
      profile,
    });
  } catch (error: any) {
    console.error('[auth/me] error:', error);
    if (String(error?.message ?? '').toLowerCase().includes('auth')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/auth/profile
 * Protected update of basic profile fields.
 */
app.patch('/api/auth/profile', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.uid;
    const updates: any = {};
    if (req.body?.chronologicalAgeYears !== undefined) {
      const val = Number(req.body.chronologicalAgeYears);
      if (Number.isNaN(val)) {
        return res.status(400).json({ error: 'chronologicalAgeYears must be a number' });
      }
      updates.chronologicalAgeYears = val;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No updatable fields provided' });
    }

    updates.updatedAt = new Date().toISOString();

    await firestore.collection('users').doc(userId).set(updates, { merge: true });
    const updated = await getOrCreateUserProfile(userId);
    return res.json(updated);
  } catch (error: any) {
    console.error('[auth/profile] error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/age/daily-update', requireAuth, async (req: AuthenticatedRequest, res) => {
  console.log('[daily-update] body:', JSON.stringify(req.body, null, 2));
  try {
    const body = req.body as { metrics?: Partial<DailyMetrics> };
    const userId = req.user!.uid;

    const user = await getUserDocument(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found. Complete onboarding first.' });
    }

    const chronologicalAgeYears = user.chronologicalAgeYears;

    const metrics = normalizeDailyMetrics(body.metrics ?? body);

    const { score, deltaYears, reasons } = calculateDailyScore(metrics);

    // Build updated state
    const baselineBiologicalAgeYears = user.baselineBiologicalAgeYears;
    const prevBiologicalAge =
      user.currentBiologicalAgeYears ?? user.baselineBiologicalAgeYears ?? chronologicalAgeYears;
    const currentBiologicalAgeYears = prevBiologicalAge + deltaYears;
    const currentAgingDebtYears = currentBiologicalAgeYears - chronologicalAgeYears;

    const threshold = 0.0001;
    let rejuvenationStreakDays = user.rejuvenationStreakDays ?? 0;
    let accelerationStreakDays = user.accelerationStreakDays ?? 0;
    let totalRejuvenationDays = user.totalRejuvenationDays ?? 0;
    let totalAccelerationDays = user.totalAccelerationDays ?? 0;

    if (deltaYears <= -threshold) {
      rejuvenationStreakDays += 1;
      accelerationStreakDays = 0;
      totalRejuvenationDays += 1;
    } else if (deltaYears >= threshold) {
      accelerationStreakDays += 1;
      rejuvenationStreakDays = 0;
      totalAccelerationDays += 1;
    }

    // Persist daily entry with snapshot of the new global state
    await saveDailyEntry(
      userId,
      metrics,
      { score, deltaYears, reasons },
      {
        currentBiologicalAgeYears,
        currentAgingDebtYears,
        rejuvenationStreakDays,
        accelerationStreakDays,
      }
    );

    // Persist root doc state (chronological age remains untouched)
    await updateUserAfterDaily(userId, {
      currentBiologicalAgeYears,
      currentAgingDebtYears,
      rejuvenationStreakDays,
      accelerationStreakDays,
      totalRejuvenationDays,
      totalAccelerationDays,
    });

    const state: BiologicalAgeState = {
      chronologicalAgeYears,
      baselineBiologicalAgeYears,
      currentBiologicalAgeYears,
      agingDebtYears: currentAgingDebtYears,
      rejuvenationStreakDays,
      accelerationStreakDays,
      totalRejuvenationDays,
      totalAccelerationDays,
    };

    const today: TodayEntry = {
      date: metrics.date,
      score,
      deltaYears,
      reasons,
    };

    const response: DailyUpdateResponse = {
      state,
      today,
    };

    console.log('[daily-update] result:', {
      userId,
      chronologicalAgeYears,
      baselineBiologicalAgeYears,
      currentBiologicalAgeYears,
      currentAgingDebtYears,
      score,
      deltaYears,
    });

    return res.json(response);
  } catch (error: any) {
    console.error('[daily-update] error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/age/state/:userId', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.uid;

    const user = await getUserDocument(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({
      profile: {
        chronologicalAgeYears: user.chronologicalAgeYears,
        baselineBiologicalAgeYears: user.baselineBiologicalAgeYears,
      },
      state: {
        currentBiologicalAgeYears: user.currentBiologicalAgeYears,
        agingDebtYears: user.currentAgingDebtYears,
        rejuvenationStreakDays: user.rejuvenationStreakDays,
        accelerationStreakDays: user.accelerationStreakDays,
        totalRejuvenationDays: user.totalRejuvenationDays,
        totalAccelerationDays: user.totalAccelerationDays,
      },
    });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/age/morning-briefing', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const message = await generateAgeMessage(userId, 'morning');
    return res.json({ message });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/age/evening-briefing', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const message = await generateAgeMessage(userId, 'evening');
    return res.json({ message });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Score endpoints
app.post('/api/score/onboarding', async (req, res) => {
  try {
    const { userId, answers } = req.body;

    if (!userId || !answers) {
      return res
        .status(400)
        .json({ error: 'userId and answers are required' });
    }

    const state = await setOnboardingScore(
      userId,
      answers as ScoreOnboardingAnswers
    );

    return res.json({
      baselineScore: state.baselineScore,
      currentScore: state.currentScore,
      breakdown: state.breakdown,
      insights: state.insights,
    });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/score/daily', async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const typedMetrics = normalizeDailyMetrics(req.body);
    // Legacy score path expects old DailyMetrics shape; cast to keep compatibility.
    const updatedState = await updateScoreFromDaily(userId, typedMetrics as any);

    if (!updatedState) {
      return res
        .status(404)
        .json({ error: 'User score not found. Complete onboarding first.' });
    }

    return res.json({
      baselineScore: updatedState.baselineScore,
      currentScore: updatedState.currentScore,
      breakdown: updatedState.breakdown,
      insights: updatedState.insights,
    });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/score/state/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const state = getScoreState(userId);

    if (!state) {
      return res.status(404).json({ error: 'User score not found. Complete onboarding first.' });
    }

    return res.json({
      baselineScore: state.baselineScore,
      currentScore: state.currentScore,
      breakdown: state.breakdown,
      insights: state.insights,
    });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/age/trend/:userId', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.uid;
    const range = (req.query.range as string) || 'weekly';

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    let limit: number;
    switch (range) {
      case 'weekly':
        limit = 7;
        break;
      case 'monthly':
        limit = 30;
        break;
      case 'yearly':
        limit = 365;
        break;
      default:
        return res.status(400).json({ error: 'Invalid range. Use weekly, monthly, or yearly' });
    }

    const user = await getUserDocument(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found. Complete onboarding first.' });
    }

    const entries = await listDailyEntries(userId);
    const sortedEntries = entries
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-limit);

    const points = sortedEntries.map((entry) => ({
      date: entry.date,
      biologicalAgeYears: entry.currentBiologicalAgeYears ?? user.currentBiologicalAgeYears,
      agingDebtYears:
        (entry.currentBiologicalAgeYears ?? user.currentBiologicalAgeYears) -
        user.chronologicalAgeYears,
    }));

    return res.json({
      range,
      points,
      summary: {
        currentBiologicalAgeYears: user.currentBiologicalAgeYears,
        agingDebtYears: user.currentAgingDebtYears,
        rejuvenationStreakDays: user.rejuvenationStreakDays,
        accelerationStreakDays: user.accelerationStreakDays,
        totalRejuvenationDays: user.totalRejuvenationDays,
        totalAccelerationDays: user.totalAccelerationDays,
      },
    });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// Longevity Scoring Engine API Endpoints
// ============================================

/**
 * POST /api/onboarding/submit
 * Submit onboarding answers and calculate baseline biological age.
 */
app.post('/api/onboarding/submit', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const body = req.body as OnboardingSubmitRequest;
    const userId = req.user!.uid;
    const { chronologicalAgeYears, answers } = body;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    if (
      chronologicalAgeYears === undefined ||
      chronologicalAgeYears === null ||
      Number.isNaN(Number(chronologicalAgeYears))
    ) {
      return res.status(400).json({ error: 'chronologicalAgeYears is required' });
    }

    const requiredFields = [
      'activity',
      'smokingAlcohol',
      'metabolicHealth',
      'energyFocus',
      'visceralFat',
      'sleep',
      'stress',
      'muscle',
      'nutritionPattern',
      'sugar',
    ] as const;

    if (!answers || typeof answers !== 'object') {
      return res.status(400).json({ error: 'answers object is required' });
    }

    for (const field of requiredFields) {
      if (answers[field] === undefined || answers[field] === null) {
        return res
          .status(400)
          .json({ error: `Missing answer for field: ${field}`, field: `answers.${field}` });
      }
      if (!Number.isFinite(Number(answers[field]))) {
        return res.status(400).json({ error: `Invalid number for field: ${field}` });
      }
    }

    const chronologicalAge = Number(chronologicalAgeYears);
    console.log('[onboarding] computeOnboardingResult start');
    const result = calculateOnboardingResult(answers, chronologicalAge);
    console.log('[onboarding] computeOnboardingResult done:', {
      chronologicalAge,
      totalScore: result.totalScore,
      BAOYears: result.BAOYears,
      baselineBiologicalAgeYears: result.baselineBiologicalAgeYears,
    });

    // Persist user root doc (baseline + current state). Keep chrono fixed.
    await upsertUserOnboarding({
      userId,
      chronologicalAgeYears: chronologicalAge,
      answers,
      onboardingTotalScore: result.totalScore,
      baselineBiologicalAgeYears: result.baselineBiologicalAgeYears,
      baselineBAOYears: result.BAOYears,
    });

    const response: OnboardingSubmitResponse = {
      userId,
      chronologicalAgeYears: chronologicalAge,
      baselineBiologicalAgeYears: result.baselineBiologicalAgeYears,
      currentBiologicalAgeYears: result.baselineBiologicalAgeYears,
      BAOYears: result.BAOYears,
      totalScore: result.totalScore,
    };

    console.log('[onboarding] success for userId:', userId, response);
    return res.json(response);
  } catch (error: any) {
    console.error('[onboarding] error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      debug: process.env.NODE_ENV === 'development' ? String(error?.message ?? error) : undefined,
    });
  }
});

/**
 * GET /api/stats/summary?userId=
 * Returns biological age state and chart-friendly history arrays.
 */
app.get('/api/stats/summary', requireAuth, async (req: AuthenticatedRequest, res) => {
  const startTime = Date.now();
  try {
    const userId = req.user!.uid;

    const user = await getUserDocument(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found. Complete onboarding first.' });
    }

    const baselineBiologicalAgeYears = user.baselineBiologicalAgeYears;
    const currentBiologicalAgeYears =
      user.currentBiologicalAgeYears ?? user.baselineBiologicalAgeYears;
    const state: BiologicalAgeState = {
      chronologicalAgeYears: user.chronologicalAgeYears,
      baselineBiologicalAgeYears,
      currentBiologicalAgeYears,
      agingDebtYears: currentBiologicalAgeYears - user.chronologicalAgeYears,
      rejuvenationStreakDays: user.rejuvenationStreakDays ?? 0,
      accelerationStreakDays: user.accelerationStreakDays ?? 0,
      totalRejuvenationDays: user.totalRejuvenationDays ?? 0,
      totalAccelerationDays: user.totalAccelerationDays ?? 0,
    };

    const todayDate = new Date().toISOString().slice(0, 10);
    const todayEntry = await getDailyEntry(userId, todayDate);

    const entries = await listDailyEntries(userId);
    const sorted = entries.sort((a, b) => a.date.localeCompare(b.date));

    // Aggregate history; use stored snapshots when available, otherwise accumulate.
    let runningBio = baselineBiologicalAgeYears;
    const history: HistoryPoint[] = sorted.map((entry) => {
      if (entry.currentBiologicalAgeYears !== undefined) {
        runningBio = entry.currentBiologicalAgeYears;
      } else {
        runningBio += entry.deltaYears;
      }
      return {
        date: entry.date,
        biologicalAgeYears: runningBio,
        deltaYears: entry.deltaYears,
        score: entry.score,
      };
    });

    const daysAgo = (dateStr: string) => {
      const diffMs = Date.now() - new Date(dateStr).getTime();
      return diffMs / (1000 * 60 * 60 * 24);
    };

    const weeklyHistory = history.filter((h) => daysAgo(h.date) <= 14);
    const monthlyHistory = history.filter((h) => daysAgo(h.date) <= 60);
    const yearlyHistory = history.filter((h) => daysAgo(h.date) <= 365);

    const response: StatsSummaryResponse = {
      userId,
      state,
      today: todayEntry
        ? {
            date: todayEntry.date,
            score: todayEntry.score,
            deltaYears: todayEntry.deltaYears,
            reasons: todayEntry.reasons,
          }
        : undefined,
      weeklyHistory,
      monthlyHistory,
      yearlyHistory,
    };

    console.log('[stats/summary] Response ready in', Date.now() - startTime, 'ms', {
      weeklyPoints: weeklyHistory.length,
      monthlyPoints: monthlyHistory.length,
      yearlyPoints: yearlyHistory.length,
      currentBiologicalAgeYears: state.currentBiologicalAgeYears,
    });

    return res.json(response);
  } catch (error: any) {
    console.error('[stats/summary] error after', Date.now() - startTime, 'ms:', error);
    return res.status(500).json({
      error: 'Internal server error',
      debug: process.env.NODE_ENV === 'development' ? String(error?.message ?? error) : undefined,
    });
  }
});

const PORT = process.env.PORT || 4000;

app.listen(PORT, async () => {
  console.log(`thelongevityapp-backend listening on :${PORT}`);
  try {
    await ingestKnowledgeDir();
    console.log('Knowledge ingested on startup');
  } catch (error) {
    console.error('Error ingesting knowledge on startup:', error);
  }
});

