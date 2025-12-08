import { openai } from '../config/openai';
import { searchSimilar } from './vectorStore';
import { ingestUserLog } from './ingest';
import { getBiologicalAgeState } from '../age/ageStore';

export async function longevityChat(options: {
  userId: string;
  message: string;
}): Promise<{ answer: string; contextItems: any[] }> {
  console.log('CHAT userId:', options.userId);
  const ageState = getBiologicalAgeState(options.userId);
  console.log('CHAT ageState found:', ageState);

  // Build age summary
  let ageSummary = 'No biological age data yet.';
  if (ageState) {
    const lastEntry = ageState.history[ageState.history.length - 1];
    ageSummary = `
Chronological age: ${ageState.chronologicalAgeYears.toFixed(1)}
Current biological age: ${ageState.currentBiologicalAgeYears.toFixed(2)}
Aging debt: ${ageState.agingDebtYears.toFixed(2)} years
Rejuvenation streak days: ${ageState.rejuvenationStreakDays}
Acceleration streak days: ${ageState.accelerationStreakDays}
Total rejuvenation days: ${ageState.totalRejuvenationDays}
Total acceleration days: ${ageState.totalAccelerationDays}
Last day score: ${lastEntry?.score ?? 'n/a'}
Last day deltaYears: ${lastEntry?.deltaYears.toFixed(3) ?? 'n/a'}
`.trim();
  }

  // Create embedding for the user's message
  const embeddingResp = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: options.message,
  });
  const queryEmbedding = embeddingResp.data[0].embedding;

  // Search for similar context items
  const contextItems = searchSimilar(queryEmbedding, {
    topK: 6,
    userId: options.userId,
  });

  // Build context text
  const contextText = contextItems
    .map(
      (item, i) =>
        `# Context ${i + 1} (source: ${item.metadata.source})\n${item.text}`
    )
    .join('\n\n');

  // Define system prompt
  const systemPrompt = `You are Longevity AI, a calm but honest longevity & healthspan coach.

You see:
- the user's chronological age,
- biological age,
- aging debt,
- streaks of rejuvenation vs accelerated aging days.

You MUST:
- mention whether the user is currently aging faster, slower, or similar to their chronological age,
- reference the aging debt and streaks in the first 2–3 sentences when ageState is available,
- give 2–4 concrete behavioural actions (sleep, movement, nutrition, stress, digital hygiene),
- distinguish clearly between "today's behaviours" and long-term patterns,
- avoid medical diagnoses and keep it habit-focused.

Tone: "coach + analyst": kind, clear, sometimes a bit direct, but never shaming.

Use ONLY the provided context and the user's own logs for concrete claims.

If something is uncertain, clearly say it is based on limited data.`;

  // Build user content with biological age state, RAG context, and user question
  const userContent = `
BIOLOGICAL AGE STATE:
${ageSummary}

RAG CONTEXT:
${contextText}

USER QUESTION:
${options.message}
`.trim();

  // Call OpenAI chat completions
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
  });

  // Safely extract answer
  const answer =
    completion.choices[0]?.message?.content ?? 'No response generated.';

  // Ingest the user log
  await ingestUserLog(
    options.userId,
    `User asked: ${options.message}\nAI answered: ${answer}`
  );

  return { answer, contextItems };
}

