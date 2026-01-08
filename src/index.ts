import express, { Express } from 'express';
import cors from 'cors';
import { DateTime } from 'luxon';
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
  hasCompletedOnboarding,
  getTodayDateKey,
  hasDailyEntryForDateKey,
  getChatHistory,
  saveChatMessage,
  getDailyEntriesForTrends,
} from './longevity/longevityStore';
import {
  OnboardingSubmitRequest,
  OnboardingSubmitResponse,
  DailyEntryDocument,
  DeltaAnalyticsResponse,
  WeeklyDeltaResponse,
  MonthlyDeltaResponse,
  YearlyDeltaResponse,
  DeltaSummary,
  DeltaSeriesPoint,
  MonthlyDeltaSeriesPoint,
  BiologicalAgeState,
  DailyMetrics,
  DailyUpdateResponse,
  HistoryPoint,
  TodayEntry,
  StatsSummaryResponse,
  TrendResponse,
  TrendPeriod,
  TrendPoint,
} from './longevity/longevityModel';
import { requireAuth, AuthenticatedRequest } from './auth/authMiddleware';
import { verifyIdToken, getOrCreateUserProfile, calculateAgeFromDateOfBirth } from './auth/firebaseAuth';
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

app.post('/api/chat', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { message } = req.body;
    const userId = req.user!.uid; // Get userId from auth token
    
    console.log('[chat] Request received:', { userId, messageLength: message?.length });
    
    if (!message) {
      console.error('[chat] Missing required field: message');
      return res.status(400).json({ error: 'message is required' });
    }

    if (typeof message !== 'string' || message.trim().length === 0) {
      console.error('[chat] Invalid message:', message);
      return res.status(400).json({ error: 'message must be a non-empty string' });
    }

    console.log('[chat] Calling longevityChat...');
    const result = await longevityChat({ userId, message: message.trim() });
    console.log('[chat] Success, answer length:', result.answer?.length);
    
    return res.json(result);
  } catch (error: any) {
    console.error('[chat] Error:', error);
    console.error('[chat] Error stack:', error?.stack);
    console.error('[chat] Error message:', error?.message);
    
    // Return more detailed error in development
    const errorMessage = process.env.NODE_ENV === 'development' 
      ? error?.message || 'Internal server error'
      : 'Internal server error';
    
    return res.status(500).json({ 
      error: 'Internal server error',
      message: errorMessage,
      ...(process.env.NODE_ENV === 'development' && { stack: error?.stack })
    });
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
 * Accepts optional firstName, lastName, dateOfBirth for sign-up flow.
 */
app.post('/api/auth/me', async (req, res) => {
  try {
    const { idToken, firstName, lastName, dateOfBirth } = req.body || {};
    if (!idToken || typeof idToken !== 'string') {
      return res.status(400).json({ error: 'idToken is required' });
    }

    const decoded = await verifyIdToken(idToken);
    
    // Prepare profile data if provided (typically during sign-up)
    const profileData: { firstName?: string; lastName?: string; dateOfBirth?: string } = {};
    if (firstName !== undefined && typeof firstName === 'string') {
      profileData.firstName = firstName.trim() || undefined;
    }
    if (lastName !== undefined && typeof lastName === 'string') {
      profileData.lastName = lastName.trim() || undefined;
    }
    if (dateOfBirth !== undefined && typeof dateOfBirth === 'string') {
      // Validate date format (ISO date string YYYY-MM-DD)
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (dateRegex.test(dateOfBirth)) {
        profileData.dateOfBirth = dateOfBirth;
      } else {
        return res.status(400).json({ error: 'dateOfBirth must be in ISO format (YYYY-MM-DD)' });
      }
    }

    const profile = await getOrCreateUserProfile(decoded.uid, decoded.email, 
      Object.keys(profileData).length > 0 ? profileData : undefined
    );

    const completedOnboarding = await hasCompletedOnboarding(decoded.uid);

    return res.json({
      uid: decoded.uid,
      email: decoded.email ?? null,
      profile,
      hasCompletedOnboarding: completedOnboarding,
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
 * Supports: firstName, lastName, dateOfBirth, chronologicalAgeYears, timezone
 * If dateOfBirth is updated, chronologicalAgeYears will be recalculated.
 */
app.patch('/api/auth/profile', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.uid;
    const updates: any = {};
    
    // Handle firstName
    if (req.body?.firstName !== undefined) {
      if (typeof req.body.firstName === 'string') {
        updates.firstName = req.body.firstName.trim() || null;
      } else if (req.body.firstName === null) {
        updates.firstName = null;
      } else {
        return res.status(400).json({ error: 'firstName must be a string or null' });
      }
    }
    
    // Handle lastName
    if (req.body?.lastName !== undefined) {
      if (typeof req.body.lastName === 'string') {
        updates.lastName = req.body.lastName.trim() || null;
      } else if (req.body.lastName === null) {
        updates.lastName = null;
      } else {
        return res.status(400).json({ error: 'lastName must be a string or null' });
      }
    }
    
    // Handle dateOfBirth
    if (req.body?.dateOfBirth !== undefined) {
      if (req.body.dateOfBirth === null) {
        updates.dateOfBirth = null;
      } else if (typeof req.body.dateOfBirth === 'string') {
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (dateRegex.test(req.body.dateOfBirth)) {
          updates.dateOfBirth = req.body.dateOfBirth;
          // Recalculate chronological age from dateOfBirth
          const calculatedAge = calculateAgeFromDateOfBirth(req.body.dateOfBirth);
          if (calculatedAge !== null) {
            updates.chronologicalAgeYears = calculatedAge;
          }
        } else {
          return res.status(400).json({ error: 'dateOfBirth must be in ISO format (YYYY-MM-DD)' });
        }
      } else {
        return res.status(400).json({ error: 'dateOfBirth must be a string or null' });
      }
    }
    
    // Handle direct chronologicalAgeYears update (deprecated, prefer dateOfBirth)
    if (req.body?.chronologicalAgeYears !== undefined) {
      const val = Number(req.body.chronologicalAgeYears);
      if (Number.isNaN(val)) {
        return res.status(400).json({ error: 'chronologicalAgeYears must be a number' });
      }
      updates.chronologicalAgeYears = val;
    }
    
    // Handle timezone (IANA timezone string, e.g. "Europe/Istanbul", "America/New_York")
    if (req.body?.timezone !== undefined) {
      if (req.body.timezone === null) {
        updates.timezone = null;
      } else if (typeof req.body.timezone === 'string') {
        const trimmed = req.body.timezone.trim();
        if (trimmed.length > 0) {
          updates.timezone = trimmed;
        } else {
          return res.status(400).json({ error: 'timezone must be a valid IANA timezone string or null' });
        }
      } else {
        return res.status(400).json({ error: 'timezone must be a string or null' });
      }
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

/**
 * POST /api/auth/logout
 * Client-side logout endpoint (logout is primarily handled client-side with Firebase Auth).
 * This endpoint can be called for consistency, but the actual logout happens on the client.
 * Returns success confirmation.
 */
app.post('/api/auth/logout', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    // Logout is handled client-side by Firebase Auth SDK.
    // This endpoint provides a place for any server-side cleanup if needed in the future.
    // For now, it just confirms the request was authenticated.
    return res.json({ success: true, message: 'Logout successful. Please sign out on the client side using Firebase Auth SDK.' });
  } catch (error: any) {
    console.error('[auth/logout] error:', error);
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

    // Get user's timezone (default to UTC if not set)
    const userTimezone = user.timezone || 'UTC';
    
    // Calculate today's dateKey in user's timezone
    const todayDateKey = getTodayDateKey(userTimezone);
    
    // Check if a daily entry already exists for today's dateKey
    const entryExists = await hasDailyEntryForDateKey(userId, todayDateKey);
    if (entryExists) {
      return res.status(409).json({
        error: 'Daily check-in already completed',
        message: 'You have already completed your daily check-in for today.',
        dateKey: todayDateKey,
      });
    }

    const chronologicalAgeYears = user.chronologicalAgeYears;

    // Normalize metrics and set date to today's dateKey
    const rawMetrics = normalizeDailyMetrics(body.metrics ?? body);
    const metrics: DailyMetrics = {
      ...rawMetrics,
      date: todayDateKey, // Use dateKey as the date field
    };

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

    // Calculate delta vs previous entry (biological age difference)
    // Get previous entry to calculate actual delta
    const allEntries = await listDailyEntries(userId);
    let actualDeltaYears = deltaYears; // Default to calculated delta from daily score
    
    // Get last check-in date for streak calculation
    let lastCheckInDateKey: string | null = null;
    if (allEntries.length > 0) {
      // Get the most recent entry (last one in sorted array)
      const previousEntry = allEntries[allEntries.length - 1];
      lastCheckInDateKey = previousEntry.dateKey || previousEntry.date || null;
      const previousBioAge = previousEntry.currentBiologicalAgeYears ?? baselineBiologicalAgeYears;
      // Calculate actual delta: today's bio age - previous bio age
      actualDeltaYears = Math.round((currentBiologicalAgeYears - previousBioAge) * 100) / 100;
      console.log('[daily-update] Calculated delta vs previous entry:', {
        previousBioAge,
        currentBioAge: currentBiologicalAgeYears,
        actualDeltaYears,
      });
    } else {
      // First entry: delta is 0 (no previous entry to compare)
      actualDeltaYears = 0;
      console.log('[daily-update] First entry, delta set to 0');
    }

    // Calculate streak based on consecutive days (date-based)
    // Convert dateKeys (YYYY-MM-DD format) to DateTime objects for comparison
    // Parse in user's timezone to ensure timezone-safe calendar day calculation
    const todayDate = DateTime.fromISO(todayDateKey, { zone: userTimezone });
    let diffInDays: number | null = null;
    
    if (lastCheckInDateKey) {
      const lastCheckInDate = DateTime.fromISO(lastCheckInDateKey, { zone: userTimezone });
      if (todayDate.isValid && lastCheckInDate.isValid) {
        // Calculate difference in calendar days
        // Use startOf('day') to normalize and ensure accurate calendar day calculation
        const todayStart = todayDate.startOf('day');
        const lastStart = lastCheckInDate.startOf('day');
        const diff = todayStart.diff(lastStart, 'days');
        diffInDays = Math.round(diff.as('days'));
        console.log('[daily-update] Date comparison for streak:', {
          todayDateKey,
          lastCheckInDateKey,
          diffInDays,
          userTimezone,
        });
      } else {
        console.warn('[daily-update] Invalid date parsing:', {
          todayDateKey,
          lastCheckInDateKey,
          todayValid: todayDate.isValid,
          lastValid: lastCheckInDate.isValid,
        });
      }
    }

    // Update streaks based on consecutive days and actual delta
    // Rules:
    // - diffInDays === 0: same day (shouldn't happen due to duplicate check, but handle safely)
    // - diffInDays === 1: consecutive day → increment appropriate streak
    // - diffInDays > 1: gap → reset streak to 1 (if delta is significant) or 0
    // - diffInDays === null: first check-in → set streak to 1 (if delta is significant) or 0
    
    if (diffInDays === null || diffInDays > 1) {
      // Gap or first check-in: reset streaks
      if (actualDeltaYears <= -threshold) {
        rejuvenationStreakDays = 1;
        accelerationStreakDays = 0;
        totalRejuvenationDays += 1;
      } else if (actualDeltaYears >= threshold) {
        accelerationStreakDays = 1;
        rejuvenationStreakDays = 0;
        totalAccelerationDays += 1;
      } else {
        // No significant delta: reset both streaks to 0
        rejuvenationStreakDays = 0;
        accelerationStreakDays = 0;
      }
    } else if (diffInDays === 1) {
      // Consecutive day: increment appropriate streak
      if (actualDeltaYears <= -threshold) {
        rejuvenationStreakDays += 1;
        accelerationStreakDays = 0;
        totalRejuvenationDays += 1;
      } else if (actualDeltaYears >= threshold) {
        accelerationStreakDays += 1;
        rejuvenationStreakDays = 0;
        totalAccelerationDays += 1;
      } else {
        // No significant delta: reset both streaks to 0
        rejuvenationStreakDays = 0;
        accelerationStreakDays = 0;
      }
    } else if (diffInDays === 0) {
      // Same day: do nothing (streak unchanged)
      // This shouldn't happen due to duplicate check, but handle safely
      console.log('[daily-update] Same day check-in detected, streaks unchanged');
    }

    // Persist daily entry with snapshot of the new global state
    // Note: saveDailyEntry now requires dateKey as second parameter and will throw if entry exists
    await saveDailyEntry(
      userId,
      todayDateKey,
      metrics,
      { score, deltaYears: actualDeltaYears, reasons }, // Use actual delta vs previous entry
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
      date: todayDateKey,
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
      timezone: userTimezone,
      dateKey: todayDateKey,
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
    
    // Handle specific error for duplicate entry (shouldn't happen due to pre-check, but handle anyway)
    if (error.message && error.message.includes('Daily check-in already completed')) {
      return res.status(409).json({
        error: 'Daily check-in already completed',
        message: error.message,
      });
    }
    
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

    // Check if onboarding is already completed
    const alreadyCompleted = await hasCompletedOnboarding(userId);
    if (alreadyCompleted) {
      return res.status(409).json({
        error: 'Onboarding already completed',
        message: 'User has already completed onboarding. To update onboarding data, please contact support.',
      });
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
 * GET /api/debug/onboarding-status
 * Debug endpoint to check onboarding status for current user.
 */
app.get('/api/debug/onboarding-status', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.uid;
    const userDoc = await getUserDocument(userId);
    
    if (!userDoc) {
      return res.json({
        userId,
        userExists: false,
        hasCompletedOnboarding: false,
        onboardingAnswers: null,
        message: 'User document not found',
      });
    }
    
    const hasAnswers = !!(userDoc.onboardingAnswers && typeof userDoc.onboardingAnswers === 'object');
    const completed = await hasCompletedOnboarding(userId);
    
    return res.json({
      userId,
      userExists: true,
      hasCompletedOnboarding: completed,
      onboardingAnswers: userDoc.onboardingAnswers || null,
      onboardingAnswersType: typeof userDoc.onboardingAnswers,
      baselineBiologicalAgeYears: userDoc.baselineBiologicalAgeYears,
      onboardingTotalScore: userDoc.onboardingTotalScore,
      message: completed ? 'Onboarding completed' : 'Onboarding not completed',
    });
  } catch (error: any) {
    console.error('[debug/onboarding-status] error:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
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

    // Get today's dateKey in user's timezone
    const userTimezone = user.timezone || 'UTC';
    const todayDateKey = getTodayDateKey(userTimezone);
    const todayEntry = await getDailyEntry(userId, todayDateKey);

    const entries = await listDailyEntries(userId);
    // Sort by dateKey if available, otherwise fall back to date
    const sorted = entries.sort((a, b) => {
      const dateA = a.dateKey || a.date;
      const dateB = b.dateKey || b.date;
      return dateA.localeCompare(dateB);
    });

    // Aggregate history; use stored snapshots when available, otherwise accumulate.
    let runningBio = baselineBiologicalAgeYears;
    const history: HistoryPoint[] = sorted.map((entry) => {
      if (entry.currentBiologicalAgeYears !== undefined) {
        runningBio = entry.currentBiologicalAgeYears;
      } else {
        runningBio += entry.deltaYears;
      }
      return {
        date: entry.dateKey || entry.date,
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

    const completedOnboarding = await hasCompletedOnboarding(userId);

    const response: StatsSummaryResponse = {
      userId,
      state,
      today: todayEntry
        ? {
            date: todayEntry.dateKey || todayEntry.date,
            score: todayEntry.score,
            deltaYears: todayEntry.deltaYears,
            reasons: todayEntry.reasons,
          }
        : undefined,
      weeklyHistory,
      monthlyHistory,
      yearlyHistory,
      hasCompletedOnboarding: completedOnboarding,
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

/**
 * Helper function to round to 2 decimals
 */
function roundTo2Decimals(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Calculate trend period data
 * If entries.length < requiredDays but >= 2, calculate trend from first to last entry
 * This allows showing graphs even with limited data
 */
function calculateTrendPeriod(
  entries: DailyEntryDocument[],
  requiredDays: number,
  pointsCount: number
): TrendPeriod {
  // Always return points if we have any entries
  const points: TrendPoint[] = entries
    .slice(-pointsCount)
    .map((e) => ({
      date: e.dateKey || e.date,
      biologicalAge: roundTo2Decimals(e.currentBiologicalAgeYears ?? 0),
    }));

  // If we have less than required days, calculate partial trend (first to last)
  if (entries.length < requiredDays) {
    // If we have at least 2 entries, calculate trend from first to last
    if (entries.length >= 2) {
      const firstEntry = entries[0];
      const lastEntry = entries[entries.length - 1];
      
      const firstBioAge = firstEntry.currentBiologicalAgeYears ?? 0;
      const lastBioAge = lastEntry.currentBiologicalAgeYears ?? 0;
      const value = roundTo2Decimals(lastBioAge - firstBioAge);

      return {
        value,
        available: false, // Not enough data for full period, but we have a partial trend
        points,
      };
    }
    
    // Less than 2 entries - no trend to calculate
    return {
      value: null,
      available: false,
      points,
    };
  }

  // We have enough entries for full period calculation
  const todayEntry = entries[entries.length - 1];
  const pastEntry = entries[entries.length - requiredDays];
  
  const todayBioAge = todayEntry.currentBiologicalAgeYears ?? 0;
  const pastBioAge = pastEntry.currentBiologicalAgeYears ?? 0;
  const value = roundTo2Decimals(todayBioAge - pastBioAge);

  return {
    value,
    available: true,
    points,
  };
}

/**
 * Delta Analytics Helper Functions
 */

/**
 * Get week range (Monday to Sunday) for a given date in user's timezone
 * Luxon's startOf('week') uses Monday as the first day (ISO 8601 standard)
 */
function getWeekRange(date: DateTime, timezone: string): { start: string; end: string } {
  const dt = date.setZone(timezone);
  // Get Monday of the week (Luxon uses ISO 8601, so Monday = weekday 1)
  const monday = dt.startOf('week');
  const sunday = monday.plus({ days: 6 });
  return {
    start: monday.toISODate()!,
    end: sunday.toISODate()!,
  };
}

/**
 * Get month range (first day to last day) for a given date in user's timezone
 */
function getMonthRange(date: DateTime, timezone: string): { start: string; end: string } {
  const dt = date.setZone(timezone);
  const firstDay = dt.startOf('month');
  const lastDay = dt.endOf('month');
  return {
    start: firstDay.toISODate()!,
    end: lastDay.toISODate()!,
  };
}

/**
 * Get year range (January 1 to December 31) for a given date in user's timezone
 */
function getYearRange(date: DateTime, timezone: string): { start: string; end: string } {
  const dt = date.setZone(timezone);
  const firstDay = dt.startOf('year');
  const lastDay = dt.endOf('year');
  return {
    start: firstDay.toISODate()!,
    end: lastDay.toISODate()!,
  };
}

/**
 * Generate all dates in a range (inclusive)
 */
function generateDateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const startDate = DateTime.fromISO(start);
  const endDate = DateTime.fromISO(end);
  let current = startDate;
  
  while (current <= endDate) {
    dates.push(current.toISODate()!);
    current = current.plus({ days: 1 });
  }
  
  return dates;
}

/**
 * Generate all months in a year range
 */
function generateMonthRange(start: string, end: string): string[] {
  const months: string[] = [];
  const startDate = DateTime.fromISO(start);
  const endDate = DateTime.fromISO(end);
  let current = startDate.startOf('month');
  
  while (current <= endDate) {
    months.push(current.toFormat('yyyy-MM'));
    current = current.plus({ months: 1 });
  }
  
  return months;
}

/**
 * Calculate summary from entries in a specific range
 * Note: deltaYears in system: negative = rejuvenation, positive = aging
 * For analytics: we invert to match user definition (positive = rejuvenation, negative = aging)
 */
function calculateRangeDeltaSummary(entries: DailyEntryDocument[]): {
  rangeNetDeltaYears: number;
  rejuvenationYears: number;
  agingYears: number;
  checkIns: number;
} {
  let rangeNetDelta = 0;
  let rejuvenation = 0;
  let aging = 0;
  
  entries.forEach((entry) => {
    // Invert deltaYears: negative deltaYears (rejuvenation) becomes positive delta
    // positive deltaYears (aging) becomes negative delta
    const delta = -(entry.deltaYears || 0);
    rangeNetDelta += delta;
    
    // rejuvenation = sum(max(delta, 0)) - positive deltas
    if (delta > 0) {
      rejuvenation += delta;
    }
    // aging = sum(abs(min(delta, 0))) - negative deltas (as positive)
    else if (delta < 0) {
      aging += Math.abs(delta);
    }
  });
  
  const checkIns = entries.length;
  
  return {
    rangeNetDeltaYears: roundTo2Decimals(rangeNetDelta),
    rejuvenationYears: roundTo2Decimals(rejuvenation),
    agingYears: roundTo2Decimals(aging),
    checkIns,
  };
}

/**
 * Calculate total delta summary (baseline + all daily deltas from onboarding)
 * Returns total values including baseline
 */
function calculateTotalDeltaSummary(
  baselineDeltaYears: number,
  allEntries: DailyEntryDocument[]
): {
  netDeltaYears: number;
  rejuvenationYears: number;
  agingYears: number;
} {
  let totalDailyDelta = 0;
  let totalRejuvenation = 0;
  let totalAging = 0;
  
  allEntries.forEach((entry) => {
    // Invert deltaYears: negative deltaYears (rejuvenation) becomes positive delta
    const delta = -(entry.deltaYears || 0);
    totalDailyDelta += delta;
    
    // Track rejuvenation (positive deltas) and aging (negative deltas)
    if (delta > 0) {
      totalRejuvenation += delta;
    } else if (delta < 0) {
      totalAging += Math.abs(delta);
    }
  });
  
  // netDeltaYears = baseline + all daily deltas
  const netDeltaYears = baselineDeltaYears + totalDailyDelta;
  
  // Rejuvenation and aging are only from daily deltas (baseline is separate)
  // But if baseline is negative (rejuvenation), we could add it to rejuvenation
  // However, per requirements, we show total including baseline in netDeltaYears
  // and separate rejuvenation/aging from daily deltas only
  
  return {
    netDeltaYears: roundTo2Decimals(netDeltaYears),
    rejuvenationYears: roundTo2Decimals(totalRejuvenation),
    agingYears: roundTo2Decimals(totalAging),
  };
}

/**
 * Aggregate deltas by date
 * Note: Return dailyDeltaYears (inverted from system deltaYears)
 * System: negative deltaYears = rejuvenation, positive = aging
 * Analytics: positive dailyDeltaYears = rejuvenation, negative = aging
 */
function aggregateDeltasByDate(
  entries: DailyEntryDocument[],
  dateRange: string[]
): DeltaSeriesPoint[] {
  // Create a map of dateKey -> sum of dailyDeltaYears (inverted)
  const deltaMap = new Map<string, number>();
  
  entries.forEach((entry) => {
    const dateKey = entry.dateKey || entry.date;
    const currentSum = deltaMap.get(dateKey) || 0;
    // Invert: negative deltaYears (rejuvenation) becomes positive dailyDeltaYears
    const dailyDeltaYears = -(entry.deltaYears || 0);
    deltaMap.set(dateKey, currentSum + dailyDeltaYears);
  });
  
  // Generate series with null for missing dates
  return dateRange.map((date) => ({
    date,
    dailyDeltaYears: deltaMap.has(date) ? roundTo2Decimals(deltaMap.get(date)!) : null,
  }));
}

/**
 * Aggregate deltas by month
 * Note: Return netDeltaYears (inverted from system deltaYears)
 */
function aggregateDeltasByMonth(
  entries: DailyEntryDocument[],
  monthRange: string[]
): MonthlyDeltaSeriesPoint[] {
  // Group entries by month (YYYY-MM)
  const monthMap = new Map<string, DailyEntryDocument[]>();
  
  entries.forEach((entry) => {
    const dateKey = entry.dateKey || entry.date;
    const month = DateTime.fromISO(dateKey).toFormat('yyyy-MM');
    if (!monthMap.has(month)) {
      monthMap.set(month, []);
    }
    monthMap.get(month)!.push(entry);
  });
  
  // Generate series for each month
  return monthRange.map((month) => {
    const monthEntries = monthMap.get(month) || [];
    // Invert: negative deltaYears (rejuvenation) becomes positive netDeltaYears
    const netDeltaYears = monthEntries.reduce((sum, e) => sum + (-(e.deltaYears || 0)), 0);
    const checkIns = monthEntries.length;
    const avgDeltaPerCheckIn = checkIns > 0 ? netDeltaYears / checkIns : 0;
    
    return {
      month,
      netDelta: roundTo2Decimals(netDeltaYears),
      checkIns,
      avgDeltaPerCheckIn: roundTo2Decimals(avgDeltaPerCheckIn),
    };
  });
}

/**
 * Filter entries within date range (inclusive)
 */
function filterEntriesInRange(
  entries: DailyEntryDocument[],
  start: string,
  end: string
): DailyEntryDocument[] {
  return entries.filter((entry) => {
    const dateKey = entry.dateKey || entry.date;
    return dateKey >= start && dateKey <= end;
  });
}

/**
 * Calculate yearly projection
 * Requires at least 7 days of data for a meaningful projection
 */
function calculateYearlyProjection(entries: DailyEntryDocument[]): TrendPeriod {
  // Get valid deltas (non-null, non-undefined, and non-zero for first entry)
  // First entry typically has deltaYears = 0 (no previous entry), so we filter it out
  const validDeltas = entries
    .map((e) => e.deltaYears)
    .filter((d) => d !== null && d !== undefined && !isNaN(d) && d !== 0);

  // Need at least 7 days of actual delta data for meaningful projection
  // For less than 7 days, we don't provide a projection (too unreliable)
  if (validDeltas.length < 7) {
    // Return null value but still provide points for chart display
    return {
      value: null,
      available: false,
      projection: true,
      points: entries.slice(-90).map((e) => ({
        date: e.dateKey || e.date,
        biologicalAge: roundTo2Decimals(e.currentBiologicalAgeYears ?? 0),
      })),
    };
  }

  // We have at least 7 days of delta data - use average delta for projection
  // Use last min(30, N) deltas for projection
  const deltasForProjection = validDeltas.slice(-Math.min(30, validDeltas.length));
  const averageDelta = deltasForProjection.reduce((sum, d) => sum + d, 0) / deltasForProjection.length;
  const projectedYearly = roundTo2Decimals(averageDelta * 365);

  // Points: last min(90, N) entries
  const pointsCount = Math.min(90, entries.length);
  const points: TrendPoint[] = entries.slice(-pointsCount).map((e) => ({
    date: e.dateKey || e.date,
    biologicalAge: roundTo2Decimals(e.currentBiologicalAgeYears ?? 0),
  }));

  return {
    value: projectedYearly,
    available: false,
    projection: true,
    points,
  };
}

/**
 * GET /api/longevity/trends
 * Returns weekly, monthly, and yearly trend data for the Score screen.
 * 
 * Response format:
 * {
 *   "weekly": { "value": -0.32, "available": true, "points": [...] },
 *   "monthly": { "value": -1.10, "available": true, "points": [...] },
 *   "yearly": { "value": -4.20, "available": false, "projection": true, "points": [...] }
 * }
 */
app.get('/api/longevity/trends', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.uid;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    // Get user document to verify user exists
    const user = await getUserDocument(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found. Complete onboarding first.' });
    }

    // Get up to 365 daily entries, sorted by date ascending
    const entries = await getDailyEntriesForTrends(userId, 365);
    
    console.log('[trends] Found', entries.length, 'entries for userId:', userId);

    // Calculate weekly trend (requires >= 7 entries)
    const weekly = calculateTrendPeriod(entries, 7, 7);

    // Calculate monthly trend (requires >= 30 entries)
    const monthly = calculateTrendPeriod(entries, 30, 30);

    // Calculate yearly trend
    let yearly: TrendPeriod;
    if (entries.length >= 365) {
      // Actual yearly data
      yearly = calculateTrendPeriod(entries, 365, 90);
      yearly.projection = false;
    } else {
      // Projection based on average delta
      yearly = calculateYearlyProjection(entries);
    }

    const response: TrendResponse = {
      weekly,
      monthly,
      yearly,
    };

    console.log('[trends] Response:', {
      weekly: { value: weekly.value, available: weekly.available },
      monthly: { value: monthly.value, available: monthly.available },
      yearly: { value: yearly.value, available: yearly.available, projection: yearly.projection },
    });

    return res.json(response);
  } catch (error: any) {
    console.error('[trends] error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      debug: process.env.NODE_ENV === 'development' ? String(error?.message ?? error) : undefined,
    });
  }
});

/**
 * GET /api/analytics/delta?range=weekly|monthly|yearly
 * Returns delta analytics for the Score screen graph.
 * 
 * Response format depends on range:
 * - weekly/monthly: series with daily delta values
 * - yearly: series with monthly netDelta values
 */
app.get('/api/analytics/delta', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.uid;
    const range = (req.query.range as string) || 'weekly';

    if (!['weekly', 'monthly', 'yearly'].includes(range)) {
      return res.status(400).json({ error: 'Invalid range. Use weekly, monthly, or yearly' });
    }

    // Get user document
    const user = await getUserDocument(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found. Complete onboarding first.' });
    }

    const userTimezone = user.timezone || 'UTC';
    
    // Calculate baselineDeltaYears: baselineBiologicalAge - chronologicalAge
    const baselineDeltaYears = roundTo2Decimals(
      user.baselineBiologicalAgeYears - user.chronologicalAgeYears
    );
    
    // Get all entries from onboarding to date
    const allEntries = await listDailyEntries(userId);
    
    // Calculate totalDeltaYears: baselineDeltaYears + sum(all daily deltas)
    const totalSummary = calculateTotalDeltaSummary(baselineDeltaYears, allEntries);
    const totalDeltaYears = totalSummary.netDeltaYears;
    
    // Get current date in user's timezone
    const now = DateTime.now().setZone(userTimezone);
    
    let response: DeltaAnalyticsResponse;
    
    if (range === 'weekly') {
      // Get current week range (Monday to Sunday)
      const weekRange = getWeekRange(now, userTimezone);
      const dateRange = generateDateRange(weekRange.start, weekRange.end);
      const entriesInRange = filterEntriesInRange(allEntries, weekRange.start, weekRange.end);
      
      const series = aggregateDeltasByDate(entriesInRange, dateRange);
      const rangeSummary = calculateRangeDeltaSummary(entriesInRange);
      
      // Combine total summary with range summary
      const summary: DeltaSummary = {
        netDeltaYears: totalDeltaYears, // Total from baseline + all daily deltas
        rejuvenationYears: totalSummary.rejuvenationYears,
        agingYears: totalSummary.agingYears,
        checkIns: rangeSummary.checkIns,
        rangeNetDeltaYears: rangeSummary.rangeNetDeltaYears, // Only range delta
      };
      
      response = {
        range: 'weekly',
        timezone: userTimezone,
        baselineDeltaYears,
        totalDeltaYears,
        start: weekRange.start,
        end: weekRange.end,
        series,
        summary,
      };
    } else if (range === 'monthly') {
      // Get current month range
      const monthRange = getMonthRange(now, userTimezone);
      const dateRange = generateDateRange(monthRange.start, monthRange.end);
      const entriesInRange = filterEntriesInRange(allEntries, monthRange.start, monthRange.end);
      
      const series = aggregateDeltasByDate(entriesInRange, dateRange);
      const rangeSummary = calculateRangeDeltaSummary(entriesInRange);
      
      const summary: DeltaSummary = {
        netDeltaYears: totalDeltaYears,
        rejuvenationYears: totalSummary.rejuvenationYears,
        agingYears: totalSummary.agingYears,
        checkIns: rangeSummary.checkIns,
        rangeNetDeltaYears: rangeSummary.rangeNetDeltaYears,
      };
      
      response = {
        range: 'monthly',
        timezone: userTimezone,
        baselineDeltaYears,
        totalDeltaYears,
        start: monthRange.start,
        end: monthRange.end,
        series,
        summary,
      };
    } else {
      // yearly
      // Get current year range
      const yearRange = getYearRange(now, userTimezone);
      const monthRange = generateMonthRange(yearRange.start, yearRange.end);
      const entriesInRange = filterEntriesInRange(allEntries, yearRange.start, yearRange.end);
      
      const series = aggregateDeltasByMonth(entriesInRange, monthRange);
      const rangeSummary = calculateRangeDeltaSummary(entriesInRange);
      
      const summary: DeltaSummary = {
        netDeltaYears: totalDeltaYears,
        rejuvenationYears: totalSummary.rejuvenationYears,
        agingYears: totalSummary.agingYears,
        checkIns: rangeSummary.checkIns,
        rangeNetDeltaYears: rangeSummary.rangeNetDeltaYears,
      };
      
      response = {
        range: 'yearly',
        timezone: userTimezone,
        baselineDeltaYears,
        totalDeltaYears,
        start: yearRange.start,
        end: yearRange.end,
        series,
        summary,
      };
    }

    // Log response structure for debugging
    const responseForLog = {
      range: response.range,
      timezone: response.timezone,
      baselineDeltaYears: response.baselineDeltaYears,
      totalDeltaYears: response.totalDeltaYears,
      start: response.start,
      end: response.end,
      seriesLength: range === 'yearly' 
        ? (response as YearlyDeltaResponse).series.length
        : (response as WeeklyDeltaResponse | MonthlyDeltaResponse).series.length,
      seriesSample: range === 'yearly'
        ? (response as YearlyDeltaResponse).series.slice(0, 2)
        : (response as WeeklyDeltaResponse | MonthlyDeltaResponse).series.slice(0, 2),
      summary: response.summary,
    };

    console.log('[analytics/delta] Response:', JSON.stringify(responseForLog, null, 2));

    return res.json(response);
  } catch (error: any) {
    console.error('[analytics/delta] error:', error);
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

