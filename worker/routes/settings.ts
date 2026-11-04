import { Hono } from 'hono';
import { ModelChoiceInputSchema } from '../../shared/models';
import { parseJson } from '../lib/validate';
import { modelChoice, setModel } from '../services/modelChoice';
import type { AppEnv } from '../types';
import { requireAdmin } from './profiles';

const ADMIN_ONLY = 'Only an admin can change app settings.';

export const settings = new Hono<AppEnv>()
  .get('/model', async (c) => {
    requireAdmin(c.get('isAdmin'), ADMIN_ONLY);
    return c.json(await modelChoice(c.env));
  })
  .put('/model', async (c) => {
    requireAdmin(c.get('isAdmin'), ADMIN_ONLY);
    const { model } = await parseJson(c, ModelChoiceInputSchema);
    await setModel(c.env.DB, model, c.get('ownerId'));
    return c.json(await modelChoice(c.env));
  });
