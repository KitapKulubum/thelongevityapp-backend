import { openai } from '../config/openai';
import { searchSimilar } from './vectorStore';
import { ingestUserLog } from './ingest';
import { getBiologicalAgeState } from '../age/ageStore';

export const SYSTEM_PROMPT = `
You are Longevity Coach AI inside a longevity app.

Goals:
- Help users improve healthspan with evidence-based, practical guidance.
- Ask clarifying questions when needed.

Rules:
- Do NOT diagnose. Encourage professional care for red flags.
- Be concise, actionable, and personalized.
- When user asks medical/medication/pregnancy topics: add safety disclaimer.
- If data missing (age/sex/goal/sleep/activity): ask 1-3 short questions.

Style:
- Warm, motivational, not preachy.
- Use bullet points for plans.
`;

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
    ageSummary = `
Chronological age: ${ageState.chronologicalAgeYears.toFixed(1)}
Current biological age: ${ageState.currentBiologicalAgeYears.toFixed(2)}
Aging debt: ${ageState.agingDebtYears.toFixed(2)} years
Rejuvenation streak days: ${ageState.rejuvenationStreakDays}
Acceleration streak days: ${ageState.accelerationStreakDays}
Total rejuvenation days: ${ageState.totalRejuvenationDays}
Total acceleration days: ${ageState.totalAccelerationDays}
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
  const systemPrompt = `
${SYSTEM_PROMPT}

You also have access to the user's biological age data and relevant health context.
- Mention whether the user is currently aging faster, slower, or similar to their chronological age when data is available.
- Reference the aging debt and streaks in your response.
- Use the provided RAG context and user logs for concrete claims.
- If something is uncertain, clearly say it is based on limited data.
`.trim();

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

