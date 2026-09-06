import { isAdaptiveSplitSchedulingEnabled } from '@/lib/adaptiveSplitScheduling';
import { useAuthStore } from '@/stores/authStore';

export function useAdaptiveSplitScheduling(): boolean {
  return useAuthStore((state) => isAdaptiveSplitSchedulingEnabled(state.user));
}
