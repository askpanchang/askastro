import { modelSettings } from '../../shared/models';
import type { Message } from '../../shared/session';
import { neuronsFor } from '../../shared/usage';

const num = new Intl.NumberFormat('en-IN');

/**
 * "DeepSeek V4.1 Flash · 222 neurons · 19.2 s" for a stored answer. Neurons are
 * estimated from the answer's tokens at the model's rate (as on the Usage page).
 */
export function answerMeta(
  m: Partial<Pick<Message, 'model' | 'tokensIn' | 'tokensOut' | 'durationMs'>>,
): string {
  const parts: string[] = [];
  if (m.model) parts.push(modelSettings(m.model).label);
  if (m.model && m.tokensIn != null && m.tokensOut != null) {
    const n = neuronsFor(m.model, m.tokensIn, m.tokensOut);
    parts.push(n > 0 && n < 1 ? '<1 neuron' : `${num.format(Math.round(n))} neurons`);
  }
  if (m.durationMs != null)
    parts.push(
      m.durationMs < 60_000
        ? `${(m.durationMs / 1000).toFixed(1)} s`
        : `${Math.floor(m.durationMs / 60_000)} min ${Math.round((m.durationMs % 60_000) / 1000)} s`,
    );
  return parts.join(' · ');
}
