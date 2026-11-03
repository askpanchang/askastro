import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { GeocodeResponseSchema } from '../../shared/geocode';
import { apiFetch } from './client';

export function useGeocode(q: string) {
  const query = q.trim();
  return useQuery({
    queryKey: ['geocode', query.toLowerCase()],
    enabled: query.length >= 2,
    staleTime: 24 * 60 * 60 * 1000,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      apiFetch(`/api/geocode?q=${encodeURIComponent(query)}`, GeocodeResponseSchema, { signal }),
  });
}
