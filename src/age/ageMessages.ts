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

  const summary = `
Chronological age: ${state.chronologicalAgeYears.toFixed(1)}
Current biological age: ${state.currentBiologicalAgeYears.toFixed(2)}
Aging debt: ${state.agingDebtYears.toFixed(2)} years
Rejuvenation streak: ${state.rejuvenationStreakDays} days
Acceleration streak: ${state.accelerationStreakDays} days
`;

  const systemPrompt = `You are Longevity AI, a calm but honest longevity & healthspan coach.

You see the user's biological age state and trends.

You explain whether they are aging faster or slower than their chronological age in a very simple way.

You ALWAYS:
- reflect the numbers (biological vs chronological age, aging debt),
- give 2–3 concrete actions for the next 24 hours,
- keep it non-medical, behaviour-focused, and encouraging.

Tone: "coach + analyst": kind, clear, sometimes a bit direct, but never shaming.

${mode === 'morning' 
  ? 'Focus on summarising yesterday and setting today\'s focus (sleep, movement, nutrition, stress).'
  : 'Focus on reflecting on today\'s inputs and preparing for better sleep and recovery.'
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
        content: `MODE: ${mode.toUpperCase()}\n\nBIOLOGICAL AGE STATE:\n${summary}\n\nGenerate a short message (3–6 sentences) for the user.`,
      },
    ],
  });

  const message =
    completion.choices[0]?.message?.content ??
    "I couldn't generate a message right now.";

  return message;
}

