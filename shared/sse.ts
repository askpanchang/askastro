export type SseEvent = { event: string; data: string };

/**
 * Incremental Server-Sent Events parser. Feed it text chunks; it returns the
 * complete events seen so far and keeps any partial event buffered.
 */
export class SseParser {
  private buf = '';

  push(chunk: string): SseEvent[] {
    this.buf += chunk.replace(/\r\n?/g, '\n');
    const out: SseEvent[] = [];
    let idx: number;
    while ((idx = this.buf.indexOf('\n\n')) >= 0) {
      const block = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 2);
      const ev = parseBlock(block);
      if (ev) out.push(ev);
    }
    return out;
  }

  /** Flush a trailing event that wasn't followed by a blank line. */
  end(): SseEvent[] {
    const ev = this.buf.trim() ? parseBlock(this.buf) : null;
    this.buf = '';
    return ev ? [ev] : [];
  }
}

function parseBlock(block: string): SseEvent | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  return data.length ? { event, data: data.join('\n') } : null;
}

/** Encode one SSE event. */
export function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
