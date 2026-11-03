import { useState } from 'react';

/** Current Unix time in seconds, fixed for the component's lifetime (keeps render pure). */
export function useNowSec(): number {
  const [now] = useState(() => Math.floor(Date.now() / 1000));
  return now;
}
