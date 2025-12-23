import { openai } from '../config/openai';
import { getBiologicalAgeState } from './ageStore';

export async function generateAgeMessage(
  userId: string,
  mode: 'morning' | 'evening'
): Promise<string> {
  const state = getBiologicalAgeState(userId);

  if (!state) {
    return "We don't have enough data yet. Let's start with your first daily check-in.";
  }

  const lastEntry = state.history.length > 0 ? state.history[state.history.length - 1] : null;

  const summary = `
Chronological age: ${state.chronologicalAgeYears.toFixed(1)}
Current biological age: ${state.currentBiologicalAgeYears.toFixed(2)}
Aging debt: ${state.agingDebtYears.toFixed(2)} years
Rejuvenation streak: ${state.rejuvenationStreakDays} days
Acceleration streak: ${state.accelerationStreakDays} days
Last daily change: ${lastEntry ? lastEntry.deltaYears.toFixed(3) : 'N/A'} years
Last change reasons: ${lastEntry ? lastEntry.reasons.join(', ') : 'N/A'}
`;

  const systemPrompt = `You are Longevity AI, a warm and motivational longevity coach.

Goals:
- Help users improve healthspan with evidence-based guidance.
- Focus on trend, awareness, and habit formation.

Rules:
- Do NOT diagnose.
- Use a 3-part structure for your message:
  1. Daily biological age change statement (e.g., "Your biological age decreased by 0.07 years today.")
  2. A natural language explanation based on the provided reasons.
  3. One specific micro-recommendation for tomorrow.

Style:
- Warm, motivational, not preachy.
- Concise and actionable.

${mode === 'morning' 
  ? 'This is a morning briefing. Reflect on yesterday\'s results and set the tone for today.'
  : 'This is an evening briefing. Reflect on today\'s behaviors and prepare for recovery.'
}`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: `MODE: ${mode.toUpperCase()}\n\nBIOLOGICAL AGE DATA:\n${summary}\n\nGenerate the 3-part longevity update for the user.`,
      },
    ],
  });

  const message =
    completion.choices[0]?.message?.content ??
    "I couldn't generate a message right now.";

  return message;
}

