import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  KundaliResponseSchema,
  KundaliVersionListSchema,
  type KundaliOptionsInput,
} from '../../shared/kundali';
import { apiFetch } from './client';
import { profileKeys } from './profiles';

export const kundaliKeys = {
  versions: (profileId: string) => ['kundali', 'versions', profileId] as const,
  detail: (id: string) => ['kundali', 'detail', id] as const,
};

export function useKundaliVersions(profileId: string) {
  return useQuery({
    queryKey: kundaliKeys.versions(profileId),
    queryFn: ({ signal }) =>
      apiFetch(`/api/profiles/${profileId}/kundali`, KundaliVersionListSchema, { signal }),
  });
}

export function useKundali(id: string | undefined) {
  return useQuery({
    queryKey: kundaliKeys.detail(id ?? ''),
    enabled: Boolean(id),
    // A stored kundali never changes; only its stale flag can, via the version list.
    staleTime: Infinity,
    queryFn: ({ signal }) =>
      apiFetch(`/api/kundali/${id}`, KundaliResponseSchema, { signal }).then((r) => r.kundali),
  });
}

export function useGenerateKundali(profileId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (options: KundaliOptionsInput) =>
      apiFetch(`/api/profiles/${profileId}/kundali`, KundaliResponseSchema, {
        method: 'POST',
        body: JSON.stringify(options),
      }).then((r) => r.kundali),
    onSuccess: (kundali) => {
      qc.setQueryData(kundaliKeys.detail(kundali.id), kundali);
      return Promise.all([
        qc.invalidateQueries({ queryKey: kundaliKeys.versions(profileId) }),
        qc.invalidateQueries({ queryKey: profileKeys.all }),
      ]);
    },
  });
}
