import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiErrorSchema } from '../../shared/api';
import { OkSchema } from '../../shared/profile';
import {
  DoneEventSchema,
  ErrorEventSchema,
  SessionDetailSchema,
  SessionListSchema,
  SessionResponseSchema,
  StartEventSchema,
  TokenEventSchema,
} from '../../shared/session';
import { SseParser } from '../../shared/sse';
import { ApiRequestError, apiFetch } from './client';
import { profileKeys } from './profiles';

export const sessionKeys = {
  list: (profileId: string) => ['sessions', 'list', profileId] as const,
  detail: (id: string) => ['sessions', 'detail', id] as const,
};

export function useSessions(profileId: string) {
  return useQuery({
    queryKey: sessionKeys.list(profileId),
    queryFn: ({ signal }) =>
      apiFetch(`/api/profiles/${profileId}/sessions`, SessionListSchema, { signal }),
  });
}

export function useSession(id: string) {
  return useQuery({
    queryKey: sessionKeys.detail(id),
    queryFn: ({ signal }) => apiFetch(`/api/sessions/${id}`, SessionDetailSchema, { signal }),
    // An answer still being written server-side (after Stop, or a reload mid-answer):
    // poll until it settles.
    refetchInterval: (q) =>
      q.state.data?.messages.some((m) => m.status === 'streaming') ? 1000 : false,
  });
}

export function useCreateSession(profileId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { lang?: string }) =>
      apiFetch(`/api/profiles/${profileId}/sessions`, SessionResponseSchema, {
        method: 'POST',
        body: JSON.stringify(body),
      }).then((r) => r.session),
    onSuccess: () => qc.invalidateQueries({ queryKey: sessionKeys.list(profileId) }),
  });
}

export function useUpdateSession(id: string, profileId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: { title?: string; lang?: string }) =>
      apiFetch(`/api/sessions/${id}`, SessionResponseSchema, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }).then((r) => r.session),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: sessionKeys.detail(id) }),
        qc.invalidateQueries({ queryKey: sessionKeys.list(profileId) }),
      ]),
  });
}

export function useDeleteSession(profileId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/api/sessions/${id}`, OkSchema, { method: 'DELETE' }),
    onSuccess: (_d, id) => {
      qc.removeQueries({ queryKey: sessionKeys.detail(id) });
      return Promise.all([
        qc.invalidateQueries({ queryKey: sessionKeys.list(profileId) }),
        qc.invalidateQueries({ queryKey: profileKeys.all }),
      ]);
    },
  });
}

/** Ask the server to stop the session's running answer (it saves what it has). */
export async function stopAnswer(sessionId: string): Promise<void> {
  await fetch(`/api/sessions/${sessionId}/stop`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  });
}

export type StreamResult =
  | { status: 'done'; messageId: string }
  | { status: 'error'; code: string; message: string }
  | { status: 'aborted' };

/** POST a question and consume the SSE answer stream. */
export async function streamAnswer(
  sessionId: string,
  question: string,
  handlers: { onToken: (text: string) => void; signal?: AbortSignal },
): Promise<StreamResult> {
  let res: Response;
  try {
    res = await fetch(`/api/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({ question }),
      signal: handlers.signal,
    });
  } catch (err) {
    if (handlers.signal?.aborted) return { status: 'aborted' };
    throw err;
  }
  if (!res.ok || !res.body) {
    const parsed = ApiErrorSchema.safeParse(await res.json().catch(() => null));
    if (parsed.success) {
      const { code, message, details } = parsed.data.error;
      throw new ApiRequestError(res.status, code, message, details);
    }
    throw new ApiRequestError(res.status, 'HTTP_ERROR', `Request failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  let result: StreamResult | null = null;
  try {
    while (!result) {
      const { value, done } = await reader.read();
      const events = done ? parser.end() : parser.push(decoder.decode(value, { stream: true }));
      for (const ev of events) {
        const data: unknown = JSON.parse(ev.data);
        if (ev.event === 'token') handlers.onToken(TokenEventSchema.parse(data).text);
        else if (ev.event === 'done') {
          result = { status: 'done', messageId: DoneEventSchema.parse(data).messageId };
        } else if (ev.event === 'error') {
          result = { status: 'error', ...ErrorEventSchema.parse(data) };
        } else if (ev.event === 'start') StartEventSchema.parse(data);
      }
      if (done) break;
    }
  } catch (err) {
    if (handlers.signal?.aborted) return { status: 'aborted' };
    throw err;
  } finally {
    reader.releaseLock();
  }
  return result ?? { status: 'error', code: 'STREAM_ENDED', message: 'The answer ended early.' };
}
