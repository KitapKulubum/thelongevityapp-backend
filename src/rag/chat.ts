import { openai } from '../config/openai';
import { searchSimilar } from './vectorStore';
import { ingestUserLog } from './ingest';
import {
  getUserDocument,
  listDailyEntries,
  getChatHistory,
  saveChatMessage,
  getTodayDateKey,
} from '../longevity/longevityStore';

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
  console.log('[longevityChat] Starting chat for userId:', options.userId);
  console.log('[longevityChat] Message:', options.message);
  
  try {
    // Get user document from Firestore
    console.log('[longevityChat] Fetching user document...');
    const userDoc = await getUserDocument(options.userId);
    
    if (!userDoc) {
      console.warn('[longevityChat] User document not found');
    }

    // Build age summary from Firestore data
    let ageSummary = 'No biological age data yet.';
    if (userDoc) {
      // Use toFixed(2) for chronological age to match score screen (2 decimal places)
      ageSummary = `
Chronological age: ${userDoc.chronologicalAgeYears.toFixed(2)} years
Current biological age: ${userDoc.currentBiologicalAgeYears.toFixed(2)} years
Baseline biological age: ${userDoc.baselineBiologicalAgeYears.toFixed(2)} years
Aging debt: ${userDoc.currentAgingDebtYears.toFixed(2)} years (${userDoc.currentAgingDebtYears > 0 ? 'aging faster' : userDoc.currentAgingDebtYears < 0 ? 'aging slower' : 'normal aging'})
Rejuvenation streak: ${userDoc.rejuvenationStreakDays} days
Total rejuvenation days: ${userDoc.totalRejuvenationDays}
`.trim();
    }

    // Get recent daily check-ins (last 7 days)
    console.log('[longevityChat] Fetching daily check-ins...');
    const allEntries = await listDailyEntries(options.userId);
    const recentEntries = allEntries.slice(-7); // Last 7 entries
    
    let dailyCheckInsSummary = 'No daily check-ins yet.';
    if (recentEntries.length > 0) {
      const entriesText = recentEntries.map((entry) => {
        const date = entry.dateKey || entry.date;
        return `Date: ${date}
  - Score: ${entry.score.toFixed(2)}
  - Delta: ${entry.deltaYears > 0 ? '+' : ''}${entry.deltaYears.toFixed(3)} years
  - Sleep: ${entry.sleepHours}h, Steps: ${entry.steps}, Exercise: ${entry.vigorousMinutes}min
  - Stress: ${entry.stressLevel}/10
  - Reasons: ${entry.reasons.join(', ')}`;
      }).join('\n\n');
      
      dailyCheckInsSummary = `Recent daily check-ins (last ${recentEntries.length} entries):\n${entriesText}`;
    }

    // Get chat history (last 10 messages) for OpenAI messages array
    console.log('[longevityChat] Fetching chat history...');
    const chatHistory = await getChatHistory(options.userId, 10);
    
    // Build conversation history for context summary
    let conversationContext = '';
    if (chatHistory.length > 0) {
      const recentTopics = chatHistory
        .filter(msg => msg.role === 'user')
        .slice(-3)
        .map(msg => msg.content.substring(0, 100))
        .join('; ');
      conversationContext = `Recent conversation topics: ${recentTopics}`;
    }

    // Create embedding for the user's message
    console.log('[longevityChat] Creating embedding...');
    let queryEmbedding: number[];
    try {
      const embeddingResp = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: options.message,
      });
      queryEmbedding = embeddingResp.data[0].embedding;
      console.log('[longevityChat] Embedding created, dimension:', queryEmbedding.length);
    } catch (error: any) {
      console.error('[longevityChat] Embedding error:', error?.message);
      throw new Error(`Failed to create embedding: ${error?.message}`);
    }

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
    const checkInsCount = recentEntries.length;
    const systemPrompt = `
${SYSTEM_PROMPT}

You have access to the user's comprehensive health data:
- Biological age data (chronological age, biological age, aging debt, streaks)
- Recent daily check-ins with scores, metrics, and trends (${checkInsCount} recent entries)
- Previous conversation history for context

Guidelines:
- Reference specific daily check-in data when relevant (e.g., "I see you had ${checkInsCount} check-ins recently...")
- Mention trends in their data (e.g., "Your biological age has improved by X years since baseline")
- Use conversation history to maintain context and avoid repeating information
- Be specific about their metrics (sleep hours, steps, exercise, stress levels)
- If data is missing, acknowledge it and ask for more information
- Reference previous conversations when relevant to show continuity
`.trim();

    // Build user content with all context
    const userContent = `
BIOLOGICAL AGE STATE:
${ageSummary}

DAILY CHECK-INS:
${dailyCheckInsSummary}

${conversationContext ? `CONVERSATION HISTORY:\n${conversationContext}\n\n` : ''}RAG CONTEXT (Knowledge Base):
${contextText}

CURRENT USER QUESTION:
${options.message}
`.trim();

    // Build messages array with conversation history
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];
    
    // Add chat history (last 10 messages) to maintain conversation context
    if (chatHistory.length > 0) {
      chatHistory.forEach((msg) => {
        messages.push({
          role: msg.role,
          content: msg.content,
        });
      });
    }
    
    // Add current user message
    messages.push({ role: 'user', content: userContent });

    // Call OpenAI chat completions
    console.log('[longevityChat] Calling OpenAI chat completions...');
    console.log('[longevityChat] System prompt length:', systemPrompt.length);
    console.log('[longevityChat] Total messages:', messages.length);
    console.log('[longevityChat] User content length:', userContent.length);
    
    let completion;
    try {
      completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: messages,
      });
      console.log('[longevityChat] OpenAI response received');
    } catch (error: any) {
      console.error('[longevityChat] OpenAI API error:', error?.message);
      console.error('[longevityChat] OpenAI error type:', error?.constructor?.name);
      console.error('[longevityChat] OpenAI error code:', error?.code);
      throw new Error(`OpenAI API error: ${error?.message || 'Unknown error'}`);
    }

    // Safely extract answer
    const answer =
      completion.choices[0]?.message?.content ?? 'No response generated.';
    
    console.log('[longevityChat] Answer extracted, length:', answer.length);
    
    if (answer === 'No response generated.') {
      console.warn('[longevityChat] WARNING: No response from OpenAI');
      console.warn('[longevityChat] Completion object:', JSON.stringify(completion, null, 2));
    }

    // Save conversation to history
    try {
      await saveChatMessage(options.userId, 'user', options.message);
      await saveChatMessage(options.userId, 'assistant', answer);
      console.log('[longevityChat] Conversation saved to history');
    } catch (error: any) {
      console.error('[longevityChat] Failed to save conversation:', error?.message);
      // Don't throw - history save failure shouldn't break chat
    }

    // Ingest the user log for RAG
    try {
      await ingestUserLog(
        options.userId,
        `User asked: ${options.message}\nAI answered: ${answer}`
      );
      console.log('[longevityChat] User log ingested');
    } catch (error: any) {
      console.error('[longevityChat] Failed to ingest user log:', error?.message);
      // Don't throw - log ingestion failure shouldn't break chat
    }

    console.log('[longevityChat] Returning result');
    return { answer, contextItems };
  } catch (error: any) {
    console.error('[longevityChat] Unexpected error:', error);
    console.error('[longevityChat] Error stack:', error?.stack);
    throw error;
  }
}

