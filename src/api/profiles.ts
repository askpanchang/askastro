import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import {
  OkSchema,
  ProfileDetailSchema,
  ProfileListSchema,
  ProfileResponseSchema,
  type ProfileInput,
  type ProfileList,
  type ProfilePatch,
} from '../../shared/profile';
import { apiFetch } from './client';

export const profileKeys = {
  all: ['profiles'] as const,
  list: (q: string) => ['profiles', 'list', q] as const,
  detail: (id: string) => ['profiles', 'detail', id] as const,
};

export function useProfiles(q: string) {
  return useInfiniteQuery({
    queryKey: profileKeys.list(q),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (pageParam) params.set('cursor', pageParam);
      return apiFetch(`/api/profiles?${params}`, ProfileListSchema, { signal });
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useProfile(id: string) {
  return useQuery({
    queryKey: profileKeys.detail(id),
    queryFn: ({ signal }) => apiFetch(`/api/profiles/${id}`, ProfileDetailSchema, { signal }),
  });
}

export function useCreateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ProfileInput) =>
      apiFetch('/api/profiles', ProfileResponseSchema, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: profileKeys.all }),
  });
}

export function useUpdateProfile(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: ProfilePatch) =>
      apiFetch(`/api/profiles/${id}`, ProfileResponseSchema, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: profileKeys.all }),
  });
}

export function useDeleteProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/api/profiles/${id}`, OkSchema, { method: 'DELETE' }),
    onSuccess: (_d, id) => {
      qc.removeQueries({ queryKey: profileKeys.detail(id) });
      // Drop it from cached lists right away so it never flashes back in.
      qc.setQueriesData<InfiniteData<ProfileList>>({ queryKey: ['profiles', 'list'] }, (data) =>
        data
          ? {
              ...data,
              pages: data.pages.map((p) => ({ ...p, items: p.items.filter((i) => i.id !== id) })),
            }
          : data,
      );
      return qc.invalidateQueries({ queryKey: profileKeys.all });
    },
  });
}
