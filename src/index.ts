import express, { Express } from 'express';
import cors from 'cors';
import { ingestKnowledgeDir, ingestUserLog } from './rag/ingest';
import { longevityChat } from './rag/chat';
import {
  applyDailyMetricsForUser,
  getBiologicalAgeState,
  getOrCreateBiologicalAgeState,
  getUserChronologicalAge,
  getUserProfile,
  getUserState,
  getDailyEntries,
} from './age/ageStore';
import { DailyMetrics } from './age/ageModel';
import { generateAgeMessage } from './age/ageMessages';
import {
  setOnboardingScore,
  getScoreState,
  updateScoreFromDaily,
} from './score/scoreStore';
import { OnboardingAnswers } from './score/scoreModel';

const app: Express = express();

app.use(cors());
app.use(express.json());

function normalizeDailyMetrics(body: any): DailyMetrics {
  const today = new Date().toISOString().slice(0, 10);
  const source = body.metrics ?? body;

  const toNumber = (value: any, fallback = 0) =>
    Number.isFinite(Number(value)) ? Number(value) : fallback;

  return {
    date: source.date ?? today,
    sleepHours: toNumber(source.sleepHours),
    steps: toNumber(source.steps),
    vigorousMinutes: toNumber(source.vigorousMinutes),
    processedFoodScore: toNumber(source.processedFoodScore),
    alcoholUnits: toNumber(source.alcoholUnits),
    stressLevel: toNumber(source.stressLevel),
    lateCaffeine: Boolean(source.lateCaffeine),
    screenLate: Boolean(source.screenLate ?? source.lateScreenUsage),
    bedtimeHour: toNumber(source.bedtimeHour, 23),
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

app.post('/api/age/daily-update', async (req, res) => {
  console.log('[daily-update] body:', JSON.stringify(req.body, null, 2));
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const storedAge = getUserChronologicalAge(userId);
    const chronologicalAgeYears =
      req.body.chronologicalAgeYears ?? storedAge;

    if (
      chronologicalAgeYears === undefined ||
      chronologicalAgeYears === null ||
      Number.isNaN(Number(chronologicalAgeYears))
    ) {
      return res
        .status(400)
        .json({ error: 'chronologicalAgeYears is required for this user' });
    }

    const typedMetrics = normalizeDailyMetrics(req.body);

    const { next, entry } = applyDailyMetricsForUser(
      userId,
      Number(chronologicalAgeYears),
      typedMetrics
    );

    // Get profile and state to match AgeStateResponse format
    const profile = getUserProfile(userId);
    const state = getUserState(userId);

    if (!profile || !state) {
      return res.status(404).json({ error: 'User not found' });
    }

    console.log('[daily-update] result:', {
      userId,
      deltaYears: entry.deltaYears,
      reasons: entry.reasons,
      biologicalAge: next.currentBiologicalAgeYears,
      agingDebt: next.agingDebtYears,
    });

    return res.json({
      profile: {
        chronologicalAgeYears: profile.chronologicalAgeYears,
        baselineBiologicalAgeYears: profile.baselineBiologicalAgeYears,
      },
      state: {
        currentBiologicalAgeYears: state.currentBiologicalAgeYears,
        agingDebtYears: state.agingDebtYears,
        rejuvenationStreakDays: state.rejuvenationStreakDays,
        accelerationStreakDays: state.accelerationStreakDays,
        totalRejuvenationDays: state.totalRejuvenationDays,
        totalAccelerationDays: state.totalAccelerationDays,
      },
      today: {
        deltaYears: entry.deltaYears,
        reasons: entry.reasons,
      },
    });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/age/state/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const profile = getUserProfile(userId);
    const state = getUserState(userId);

    if (!profile || !state) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({
      profile: {
        chronologicalAgeYears: profile.chronologicalAgeYears,
        baselineBiologicalAgeYears: profile.baselineBiologicalAgeYears,
      },
      state: {
        currentBiologicalAgeYears: state.currentBiologicalAgeYears,
        agingDebtYears: state.agingDebtYears,
        rejuvenationStreakDays: state.rejuvenationStreakDays,
        accelerationStreakDays: state.accelerationStreakDays,
        totalRejuvenationDays: state.totalRejuvenationDays,
        totalAccelerationDays: state.totalAccelerationDays,
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
      answers as OnboardingAnswers
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
    const updatedState = await updateScoreFromDaily(userId, typedMetrics);

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

app.get('/api/age/trend/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const range = (req.query.range as string) || 'weekly';

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    // Determine limit based on range
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

    // Get daily entries
    const dailyEntries = getDailyEntries(userId, limit);

    // Sort by date ascending for trend points
    const sortedEntries = dailyEntries.sort((a, b) => a.date.localeCompare(b.date));

    // Build trend points
    const points = sortedEntries.map((entry) => ({
      date: entry.date,
      biologicalAgeYears: entry.biologicalAgeAfter,
      agingDebtYears: entry.agingDebtAfter,
    }));

    // Calculate summary
    const state = getUserState(userId);
    const profile = getUserProfile(userId);

    if (!state || !profile) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({
      range,
      points,
      summary: {
        currentBiologicalAgeYears: state.currentBiologicalAgeYears,
        agingDebtYears: state.agingDebtYears,
        rejuvenationStreakDays: state.rejuvenationStreakDays,
        accelerationStreakDays: state.accelerationStreakDays,
        totalRejuvenationDays: state.totalRejuvenationDays,
        totalAccelerationDays: state.totalAccelerationDays,
      },
    });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
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

