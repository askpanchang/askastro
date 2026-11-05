import { z } from 'zod';
import { LANGS } from './kundali';

export const DEFAULT_SESSION_TITLE = 'New session';

export const SessionCreateSchema = z.object({ lang: z.enum(LANGS).optional() });
export const SessionPatchSchema = z
  .object({
    title: z.string().trim().min(1, 'Title is required').max(120).optional(),
    lang: z.enum(LANGS).optional(),
  })
  .refine((v) => v.title !== undefined || v.lang !== undefined, 'Nothing to update');

export const AskSchema = z.object({
  question: z
    .string()
    .trim()
    .min(1, 'Type a question')
    .max(2000, 'Questions can be at most 2000 characters'),
});

/** Person 2's relationship to Person 1 (the session's profile). */
export const RELATIONS = [
  'spouse',
  'partner',
  'parent',
  'child',
  'sibling',
  'friend',
  'business',
] as const;

/** Starters when a second person is in the session. */
export const PAIR_STARTER_QUESTIONS = {
  couple: [
    'How compatible are we?',
    'How will our married life be?',
    'What should we watch out for as a couple?',
    'Good periods for us in the next few years',
  ],
  other: [
    'How do our charts relate to each other?',
    'Where do we support each other, and where do we clash?',
    'Good periods for us to work together',
  ],
} as const;
export type Relation = (typeof RELATIONS)[number];
export const RELATION_LABELS: Record<Relation, string> = {
  spouse: 'Spouse',
  partner: 'Partner (not married)',
  parent: 'Parent',
  child: 'Child',
  sibling: 'Sibling',
  friend: 'Friend',
  business: 'Business partner',
};
/** Relations that get Ashtakoota (Guna Milan) matching. */
export const isCouple = (r: Relation) => r === 'spouse' || r === 'partner';

export const SessionPartnerSchema = z.object({
  profileId: z.string(),
  kundaliId: z.string(),
  name: z.string(),
  relation: z.enum(RELATIONS),
});
export type SessionPartner = z.infer<typeof SessionPartnerSchema>;
export const SessionPartnerInputSchema = z.object({
  profileId: z.string().min(1),
  relation: z.enum(RELATIONS),
});

export const SessionSchema = z.object({
  id: z.string(),
  profileId: z.string(),
  kundaliId: z.string(),
  title: z.string(),
  model: z.string(),
  lang: z.enum(LANGS),
  messageCount: z.number(),
  /** A second person whose chart is part of every answer (max two people). */
  partner: SessionPartnerSchema.nullish(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Session = z.infer<typeof SessionSchema>;

export const MessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  status: z.enum(['complete', 'streaming', 'error']),
  tokensIn: z.number().nullable(),
  tokensOut: z.number().nullable(),
  /** Answers only: the model that wrote it and how long it took (ms). */
  model: z.string().nullish(),
  durationMs: z.number().nullish(),
  createdAt: z.string(),
});
export type Message = z.infer<typeof MessageSchema>;

export const SessionListSchema = z.object({ items: z.array(SessionSchema) });
export const SessionResponseSchema = z.object({ session: SessionSchema });
export const SessionDetailSchema = z.object({
  session: SessionSchema,
  messages: z.array(MessageSchema),
  /** True when the profile has a newer kundali than the one this session uses, or it is stale. */
  kundaliOutdated: z.boolean(),
});
export type SessionDetail = z.infer<typeof SessionDetailSchema>;

/* Streaming events for POST /api/sessions/:id/messages */
export const TokenEventSchema = z.object({ text: z.string() });
export const DoneEventSchema = z.object({
  messageId: z.string(),
  tokensIn: z.number().nullable(),
  tokensOut: z.number().nullable(),
});
export const ErrorEventSchema = z.object({ code: z.string(), message: z.string() });
export const StartEventSchema = z.object({ userMessageId: z.string(), messageId: z.string() });

export const STARTER_QUESTIONS = [
  'Give me an overview of this chart',
  'What does my current dasha indicate?',
  'Career and profession outlook',
  'Marriage and relationships',
  'Financial tendencies and wealth yogas',
  'Which planets are strongest and weakest?',
] as const;

/** Heuristic session title from the first question: at most 6 words. */
export function titleFromQuestion(q: string): string {
  const words = q
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[?.!]+$/, '')
    .split(' ')
    .filter(Boolean);
  const t = words.slice(0, 6).join(' ');
  const title = t.charAt(0).toUpperCase() + t.slice(1);
  return (words.length > 6 ? `${title}…` : title).slice(0, 120) || DEFAULT_SESSION_TITLE;
}
