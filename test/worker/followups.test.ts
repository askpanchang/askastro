import { describe, expect, it } from 'vitest';
import {
  FOLLOWUP_MARKER,
  FollowupSplitter,
  parseFollowups,
  splitFollowups,
} from '../../worker/services/followups';

describe('follow-up questions', () => {
  it('parses bullets, numbers and quotes, at most three', () => {
    expect(
      parseFollowups(
        '\n- When will I marry?\n2. "What about career?"\n* **Children?**\n- Fourth one?\n',
      ),
    ).toEqual(['When will I marry?', 'What about career?', 'Children?']);
  });

  it('splits a finished answer and drops a dangling separator', () => {
    expect(splitFollowups(`Answer text.\n\n---\n${FOLLOWUP_MARKER}\n- Next?\n- More?`)).toEqual({
      visible: 'Answer text.',
      followups: ['Next?', 'More?'],
    });
    expect(splitFollowups('No block here.')).toEqual({ visible: 'No block here.', followups: [] });
  });

  it('never streams the marker, even when it arrives split across tokens', () => {
    const s = new FollowupSplitter();
    const tokens = ['Your marriage ', 'looks good.\n<', '<<FOLL', 'OWUPS\n- When', '?\n- Why?'];
    const streamed = tokens.map((t) => s.push(t)).join('') + s.flush();
    expect(streamed).toBe('Your marriage looks good.\n');
    expect(s.result()).toEqual({
      visible: 'Your marriage looks good.',
      followups: ['When?', 'Why?'],
    });
  });

  it('releases held-back text that turns out not to be the marker', () => {
    const s = new FollowupSplitter();
    expect(s.push('a <')).toBe('a ');
    expect(s.push('< b')).toBe('<< b');
    expect(s.flush()).toBe('');
  });
});
