import { useQuery } from '@tanstack/react-query';
import { HealthSchema } from '../../shared/api';
import { apiFetch } from './client';

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => apiFetch('/api/health', HealthSchema),
  });
}
