// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

import * as activityRules from '@/lib/workoutActivitySync';
import * as workoutProgress from '@/lib/workoutProgress';
import type { SessionModel } from '../native/src/lib/sessionModel';
import { loadNativeModule } from './helpers/loadNativeModule';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const auth = create<{ user: { id: string } | null }>(() => ({ user: { id: 'user-1' } }));
const app = create(() => ({ workoutLoadedForUserId: null as string | null, hydratedForUserId: null as string | null }));
const end = vi.fn();
const sync = vi.fn();
let root: Root;
let host: HTMLDivElement;
let useWorkoutActivity: (session: SessionModel | null) => void;
function Probe({ session = null }: { session?: SessionModel | null }) {
  useWorkoutActivity(session);
  return null;
}
const render = async (session?: SessionModel | null) => {
  await act(async () => { root.render(createElement(Probe, { session })); });
};

describe('workout lock-screen restoration', () => {
  beforeEach(() => {
    app.setState({ workoutLoadedForUserId: null, hydratedForUserId: null });
    auth.setState({ user: { id: 'user-1' } });
    end.mockReset();
    sync.mockReset();
    ({ useWorkoutActivity } = loadNativeModule<{ useWorkoutActivity: (session: SessionModel | null) => void }>('lib/workoutActivity.ts', {
      '@/lib/workoutActivitySync': activityRules,
      '@/lib/workoutProgress': workoutProgress,
      '@/stores/appStore': { useAppStore: app },
      '@/stores/authStore': { useAuthStore: auth },
      '~/platform/liveActivity': { syncWorkoutActivity: sync, endWorkoutActivity: end },
      './rest': { relabelRest: vi.fn(), restLabel: vi.fn() },
    }));
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('keeps the existing card until the workout read succeeds, then clears it even if program loading failed', async () => {
    await render();
    expect(end).not.toHaveBeenCalled();
    await act(async () => { app.setState({ workoutLoadedForUserId: 'user-1' }); });
    expect(app.getState().hydratedForUserId).toBeNull();
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('does not use another account’s successful read as proof that this workout ended', async () => {
    app.setState({ workoutLoadedForUserId: 'user-2' });
    await render();
    expect(end).not.toHaveBeenCalled();
  });

  it('updates a restored session and clears its card when that session finishes', async () => {
    const session = {
      current: null, dayName: 'Upper', doneCount: 0, sets: [], startedAt: new Date('2026-11-03T12:00:00Z'),
    } as unknown as SessionModel;
    await render(session);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(end).not.toHaveBeenCalled();
    await render(null);
    expect(end).toHaveBeenCalledTimes(1);
  });
});
