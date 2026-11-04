import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ModelChoiceSchema } from '../../shared/models';
import { apiFetch } from './client';

const modelKey = ['settings', 'model'] as const;

export function useModelChoice(enabled = true) {
  return useQuery({
    queryKey: modelKey,
    enabled,
    queryFn: ({ signal }) => apiFetch('/api/settings/model', ModelChoiceSchema, { signal }),
  });
}

export function useSetModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (model: string) =>
      apiFetch('/api/settings/model', ModelChoiceSchema, {
        method: 'PUT',
        body: JSON.stringify({ model }),
      }),
    onSuccess: (data) => qc.setQueryData(modelKey, data),
  });
}
