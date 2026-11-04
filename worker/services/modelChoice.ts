import {
  isSelectableModel,
  modelSettings,
  SELECTABLE_MODELS,
  type ModelChoice,
} from '../../shared/models';
import { getSetting, putSetting } from '../db/settings';

const KEY = 'ai_model';

/**
 * The model for new answers: the admin's pick from the Settings page, else the
 * deploy-time `AI_MODEL`. `dev:echo` in the environment always wins (local dev).
 */
export async function activeModel(env: Pick<Env, 'DB' | 'AI_MODEL'>): Promise<string> {
  if (env.AI_MODEL === 'dev:echo') return env.AI_MODEL;
  const row = await getSetting(env.DB, KEY);
  return row && isSelectableModel(row.value) ? row.value : env.AI_MODEL;
}

export async function modelChoice(env: Pick<Env, 'DB' | 'AI_MODEL'>): Promise<ModelChoice> {
  const row = await getSetting(env.DB, KEY);
  const picked = row && isSelectableModel(row.value) ? row : null;
  return {
    model: await activeModel(env),
    defaultModel: env.AI_MODEL,
    updatedBy: picked?.updated_by ?? null,
    updatedAt: picked?.updated_at ?? null,
    options: SELECTABLE_MODELS.map((m) => ({
      id: m.id,
      label: modelSettings(m.id).label,
      billing: modelSettings(m.id).paid ? 'credits' : 'free',
      summary: m.summary,
    })),
  };
}

export const setModel = (db: D1Database, model: string, by: string) =>
  putSetting(db, KEY, model, by);
