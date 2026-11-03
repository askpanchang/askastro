import { Hono } from 'hono';
import { KundaliOptionsSchema, type KundaliDetail } from '../../shared/kundali';
import { getProfile } from '../db/profiles';
import { getKundaliDetail, insertKundali, listKundaliVersions } from '../db/kundalis';
import { AppError } from '../lib/errors';
import { isId } from '../lib/ids';
import { parseValue } from '../lib/validate';
import { buildKundaliRequest, type KundaliClient } from '../services/askpanchang';
import { buildChartDigest } from '../services/chartDigest';
import type { AppEnv } from '../types';
import { requireProfile } from './profiles';

const notFound = () => new AppError(404, 'KUNDALI_NOT_FOUND', 'Kundali not found');

export function kundaliRoutes(clientFor: (env: Env) => KundaliClient) {
  return new Hono<AppEnv>()
    .post('/profiles/:id/kundali', async (c) => {
      const profile = await requireProfile(c.env.DB, c.get('ownerId'), c.req.param('id'));
      // Body is optional: an empty body means "use the defaults".
      const text = await c.req.text();
      let body: unknown = {};
      if (text.trim()) {
        try {
          body = JSON.parse(text);
        } catch {
          throw new AppError(400, 'INVALID_JSON', 'Request body must be valid JSON');
        }
      }
      const options = parseValue(KundaliOptionsSchema, body);

      const request = buildKundaliRequest(profile, options);
      const { data, raw } = await clientFor(c.env).generate(request);
      const timeUncertain = profile.tobUnknown;
      const digest = buildChartDigest({
        data,
        profile,
        timeUncertain,
        asOfSec: Math.floor(Date.now() / 1000),
      });
      const { id, createdAt } = await insertKundali(c.env.DB, {
        profile,
        options,
        requestJson: JSON.stringify(request),
        responseJson: raw,
        digest,
        timeUncertain,
      });

      const kundali: KundaliDetail = {
        id,
        profileId: profile.id,
        ayanamsa: options.ayanamsa,
        chartStyle: options.chartStyle,
        lang: options.lang,
        timeUncertain,
        stale: false,
        createdAt,
        data,
        digest,
      };
      return c.json({ kundali }, 201);
    })
    .get('/profiles/:id/kundali', async (c) => {
      const profile = await requireProfile(c.env.DB, c.get('ownerId'), c.req.param('id'));
      return c.json({ items: await listKundaliVersions(c.env.DB, profile) });
    })
    .get('/kundali/:id', async (c) => {
      const id = c.req.param('id');
      if (!isId(id)) throw notFound();
      const ownerId = c.get('ownerId');
      const kundali = await getKundaliDetail(c.env.DB, id, (pid) =>
        getProfile(c.env.DB, ownerId, pid),
      );
      if (!kundali) throw notFound();
      return c.json({ kundali });
    });
}
