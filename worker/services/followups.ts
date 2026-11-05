/**
 * Suggested follow-up questions. The model ends each answer with a line
 * `<<<FOLLOWUPS` followed by up to three questions, one per line. The server
 * streams and stores only the text before the marker, and stores the
 * questions separately; the chat shows them as buttons under the answer.
 */

export const FOLLOWUP_MARKER = '<<<FOLLOWUPS';
const MAX_FOLLOWUPS = 3;

/** Questions from the block after the marker: bullets/numbers and quotes stripped. */
export function parseFollowups(block: string): string[] {
  const out: string[] = [];
  for (const line of block.split('\n')) {
    const q = line
      .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')
      .replace(/^["“'*_]+|["”'*_]+$/g, '')
      .trim();
    if (q.length < 4 || q.length > 200 || q.includes(FOLLOWUP_MARKER)) continue;
    if (!out.some((x) => x.toLowerCase() === q.toLowerCase())) out.push(q);
    if (out.length === MAX_FOLLOWUPS) break;
  }
  return out;
}

/** Answer text before the marker, without a dangling separator or bold markers. */
function cleanVisible(text: string) {
  return text.replace(/\n\s*(?:\*\*|__|---|\*\*\*)\s*$/, '').trimEnd();
}

/** Split a complete model output into the answer and its follow-up questions. */
export function splitFollowups(raw: string): { visible: string; followups: string[] } {
  const i = raw.indexOf(FOLLOWUP_MARKER);
  if (i < 0) return { visible: raw, followups: [] };
  return {
    visible: cleanVisible(raw.slice(0, i)),
    followups: parseFollowups(raw.slice(i + FOLLOWUP_MARKER.length)),
  };
}

/**
 * Streaming version: `push` returns the newly visible text to send. Text
 * that might be the start of the marker (split across tokens) is held back
 * until it is clear; `flush` releases it at the end.
 */
export class FollowupSplitter {
  raw = '';
  private sent = 0;

  push(chunk: string): string {
    this.raw += chunk;
    return this.release(this.visibleEnd(false));
  }

  flush(): string {
    return this.release(this.visibleEnd(true));
  }

  /** Answer text so far (before the marker). */
  get visible(): string {
    const i = this.raw.indexOf(FOLLOWUP_MARKER);
    return i < 0 ? this.raw : this.raw.slice(0, i);
  }

  result() {
    return splitFollowups(this.raw);
  }

  private visibleEnd(final: boolean): number {
    const i = this.raw.indexOf(FOLLOWUP_MARKER);
    if (i >= 0) return i;
    if (final) return this.raw.length;
    // Hold back a tail that could be the beginning of the marker.
    for (let k = Math.min(FOLLOWUP_MARKER.length - 1, this.raw.length); k > 0; k--) {
      if (FOLLOWUP_MARKER.startsWith(this.raw.slice(-k))) return this.raw.length - k;
    }
    return this.raw.length;
  }

  private release(end: number): string {
    if (end <= this.sent) return '';
    const out = this.raw.slice(this.sent, end);
    this.sent = end;
    return out;
  }
}
