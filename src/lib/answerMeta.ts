import { modelSettings } from '../../shared/models';
import type { Message } from '../../shared/session';

const num = new Intl.NumberFormat('en-IN');

/** "DeepSeek V4.1 Flash · 2,415 in / 1,435 out tokens · 19.2 s" for a stored answer. */
export function answerMeta(
  m: Partial<Pick<Message, 'model' | 'tokensIn' | 'tokensOut' | 'durationMs'>>,
): string {
  const parts: string[] = [];
  if (m.model) parts.push(modelSettings(m.model).label);
  if (m.tokensIn != null && m.tokensOut != null)
    parts.push(`${num.format(m.tokensIn)} in / ${num.format(m.tokensOut)} out tokens`);
  if (m.durationMs != null)
    parts.push(
      m.durationMs < 60_000
        ? `${(m.durationMs / 1000).toFixed(1)} s`
        : `${Math.floor(m.durationMs / 60_000)} min ${Math.round((m.durationMs % 60_000) / 1000)} s`,
    );
  return parts.join(' · ');
}
