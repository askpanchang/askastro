import { useQuery } from '@tanstack/react-query';
import { MeSchema } from '../../shared/profile';
import { apiFetch } from './client';

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    staleTime: Infinity,
    queryFn: ({ signal }) => apiFetch('/api/me', MeSchema, { signal }),
  });
}
