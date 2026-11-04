import { useQuery } from '@tanstack/react-query';
import { UsageSchema } from '../../shared/usage';
import { apiFetch } from './client';

export const usageKey = ['usage'] as const;

export function useUsage() {
  return useQuery({
    queryKey: usageKey,
    // Account totals come from Cloudflare analytics (cached 60 s on the server).
    refetchInterval: 60_000,
    staleTime: 30_000,
    queryFn: ({ signal }) => apiFetch('/api/usage', UsageSchema, { signal }),
  });
}
