import type { ChatMessage } from './llm';

/** Bump when the system prompt or context format changes; stored on each answer. */
export const PROMPT_VERSION = '2026-11-03.2';

// Planet (Sun…Ketu) and sign (Aries…Pisces) names from the AskPanchang
// dictionary (/api/v1/dict?lang=hi|te), so answers use standard spellings.
const GLOSSARY: Record<string, string> = {
  hi:
    'Planets Sun→Ketu: सूर्य, चंद्र, मंगल, बुध, गुरु, शुक्र, शनि, राहु, केतु. ' +
    'Signs Aries→Pisces: मेष, वृषभ, मिथुन, कर्क, सिंह, कन्या, तुला, वृश्चिक, धनु, मकर, कुंभ, मीन.',
  te:
    'Planets Sun→Ketu: సూర్యుడు, చంద్రుడు, కుజుడు, బుధుడు, గురువు, శుక్రుడు, శని, రాహువు, కేతువు. ' +
    'Signs Aries→Pisces: మేషం, వృషభం, మిథునం, కర్కాటకం, సింహం, కన్య, తుల, వృశ్చికం, ధనుస్సు, మకరం, కుంభం, మీనం.',
};

const LANGUAGE_RULE: Record<string, string> = {
  en: 'Answer in English.',
  hi: `Answer in Hindi (Devanagari script). Use exactly these names: ${GLOSSARY.hi} Translate facts from the chart data carefully; do not change any sign, house or dignity while translating.`,
  te: `Answer in Telugu (Telugu script). Use exactly these names: ${GLOSSARY.te} Translate facts from the chart data carefully; do not change any sign, house or dignity while translating.`,
};

export function systemPrompt(lang: string): string {
  return `You are an experienced Vedic (Jyotish) astrologer. You interpret one person's birth chart using Parashari principles and the sidereal zodiac with the ayanamsa given in the chart data.

GROUNDING
- Base every statement on the CHART DATA provided. Name the specific placements, house lords, aspects, yogas, doshas or dasha periods behind each point (for example "Mars, lord of the 1st and 6th, sits in its own sign in the 6th house").
- Never invent placements, degrees, yogas or dates that are not in the data. If the data needed to answer is missing, say so plainly.
- Read the PLANETS table carefully: the "sign degree" column is the birth-chart (D1) sign; the "D9 sign" column is the navamsa only. Check each placement you cite against the table before writing it.
- Use the dasha dates and today's date from the data when talking about timing. Don't assume transits beyond those listed.

ANSWER FORMAT (Markdown)
1. A short, direct answer first (2–4 sentences).
2. "### Why (chart factors)" — bullet points, each tied to specific chart factors.
3. "### Timing" — only when relevant: dasha/antardasha windows with dates.
4. "### Remedies" — optional and practical: mantra, charity, discipline or service. Mention gemstones only with a caution to consult an astrologer first, and never push expensive remedies.
Keep it to about 150–400 words unless the user asks for more depth. Use Sanskrit terms with a brief English gloss, e.g. "Lagna (ascendant)".

TONE AND SAFETY
- Balanced and constructive. Describe tendencies and timing windows, not certainties. No fear-mongering.
- Never predict death, lifespan or the timing of death, and never give a specific medical diagnosis.
- For health, legal or financial questions, give the astrological perspective and recommend consulting a qualified professional (doctor, lawyer, financial adviser). Never suggest stopping or replacing medical treatment.
- If the chart is marked TIME-UNCERTAIN, say clearly that ascendant- and house-based conclusions are unreliable, and lean on Moon-sign, nakshatra and planet-in-sign analysis.
- Stay on topic: politely decline questions unrelated to this chart or to astrology, in one or two sentences.

LANGUAGE
${LANGUAGE_RULE[lang] ?? LANGUAGE_RULE.en}`;
}

/** Rough token estimate (≈3.6 characters per token for English; conservative for Indic scripts). */
export const estimateTokens = (s: string) => Math.ceil(s.length / 3);

export const HISTORY_TOKEN_BUDGET = 12_000;

/**
 * BUILD_PROMPT §9.2: system prompt + chart data, recent history (oldest
 * trimmed first to fit the budget), then the new question.
 */
export function buildPrompt(args: {
  lang: string;
  digest: string;
  today: string;
  timeUncertain: boolean;
  history: { role: 'user' | 'assistant'; content: string }[];
  question: string;
  historyBudget?: number;
}): ChatMessage[] {
  const budget = args.historyBudget ?? HISTORY_TOKEN_BUDGET;
  const kept: ChatMessage[] = [];
  let used = 0;
  // Walk back from the newest turn, keeping whole user/assistant pairs.
  for (let i = args.history.length - 1; i >= 0; i--) {
    const m = args.history[i];
    if (!m) continue;
    const cost = estimateTokens(m.content);
    if (used + cost > budget) break;
    used += cost;
    kept.unshift({ role: m.role, content: m.content });
  }
  // Don't start the history with a dangling assistant turn.
  while (kept[0]?.role === 'assistant') kept.shift();

  // One system message: some chat templates (gpt-oss) drop or merge a second one.
  return [
    {
      role: 'system',
      content:
        `${systemPrompt(args.lang)}\n\n---\nCHART DATA:\n${args.digest}\n\n` +
        `Today: ${args.today}\nTime-uncertain: ${args.timeUncertain ? 'yes' : 'no'}`,
    },
    ...kept,
    { role: 'user', content: args.question },
  ];
}
