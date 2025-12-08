import express, { Express } from 'express';
import cors from 'cors';
import { ingestKnowledgeDir, ingestUserLog } from './rag/ingest';
import { longevityChat } from './rag/chat';
import {
  applyDailyMetricsForUser,
  getBiologicalAgeState,
  getOrCreateBiologicalAgeState,
} from './age/ageStore';
import { DailyMetrics } from './age/ageModel';
import { generateAgeMessage } from './age/ageMessages';

const app: Express = express();

app.use(cors());
app.use(express.json());

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
  try {
    const { userId, chronologicalAgeYears, metrics } = req.body;

    if (!userId || typeof chronologicalAgeYears !== 'number' || !metrics) {
      return res
        .status(400)
        .json({ error: 'userId, chronologicalAgeYears and metrics are required' });
    }

    const typedMetrics = metrics as DailyMetrics;

    const { next, entry } = applyDailyMetricsForUser(
      userId,
      chronologicalAgeYears,
      typedMetrics
    );

    return res.json({
      state: next,
      today: entry,
    });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/age/state', (req, res) => {
  try {
    const userId = req.query.userId as string | undefined;
    const chronologicalAgeYears = req.query.chronologicalAgeYears
      ? Number(req.query.chronologicalAgeYears)
      : undefined;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    if (chronologicalAgeYears === undefined || isNaN(chronologicalAgeYears)) {
      return res.status(400).json({ error: 'chronologicalAgeYears is required' });
    }

    const state = getOrCreateBiologicalAgeState(userId, chronologicalAgeYears);
    return res.json({ state });
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

