import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSplitDraftAutosaver,
  readSplitDraft,
  splitDraftKey,
  splitSignature,
  writeSplitDraft,
} from '@/lib/splitDraftStorage';
import { blankSplitDraft } from '@/lib/splitDraftSeed';
import type { DraftSplit } from '@/lib/splitDraft';
import type { Split } from '@/types';
import { memoryStorage } from './memoryStorage';

beforeEach(() => { vi.stubGlobal('localStorage', memoryStorage()); });
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const draft = (name: string): DraftSplit => ({ ...blankSplitDraft(2), id: 'split-1', _isNew: false, name });

describe('split draft storage', () => {
  it('round-trips a draft per account and program', () => {
    writeSplitDraft('user-1', draft('A'), 'sig', 1000);
    expect(readSplitDraft('user-1', 'split-1')).toMatchObject({ savedAt: 1000, baseSignature: 'sig', draft: { name: 'A' } });
    expect(readSplitDraft('user-2', 'split-1')).toBeNull();
    expect(readSplitDraft('user-1', 'new')).toBeNull();
  });

  it('drops a corrupt or older copy instead of offering it', () => {
    localStorage.setItem(splitDraftKey('user-1', 'split-1'), '{"version":1,"draft":{"id":"x"},"savedAt":1}');
    expect(readSplitDraft('user-1', 'split-1')).toBeNull();
    expect(localStorage.getItem(splitDraftKey('user-1', 'split-1'))).toBeNull();
    localStorage.setItem(splitDraftKey('user-1', 'split-1'), 'not json');
    expect(readSplitDraft('user-1', 'split-1')).toBeNull();
  });

  it('keeps editing when storage refuses the write', () => {
    vi.stubGlobal('localStorage', { ...memoryStorage(), setItem: () => { throw new Error('quota'); } });
    expect(() => writeSplitDraft('user-1', draft('A'), null)).not.toThrow();
  });

  it('fingerprints the saved program so later changes are noticed', () => {
    const split: Split = { id: 's', user_id: 'u', name: 'P', description: null, days_per_week: 1, is_active: false, days: [] };
    expect(splitSignature(split)).toBe(splitSignature({ ...split }));
    expect(splitSignature(split)).not.toBe(splitSignature({ ...split, name: 'Q' }));
  });
});

describe('split draft autosave', () => {
  it('writes the latest dirty draft once after edits pause', () => {
    vi.useFakeTimers();
    const write = vi.fn();
    const saver = createSplitDraftAutosaver({ delayMs: 500, write });
    const first = draft('A');
    saver.update({ draft: first, isDirty: false, storageScope: 'user-1', baseSignature: null });
    vi.advanceTimersByTime(1000);
    expect(write).not.toHaveBeenCalled();

    saver.update({ draft: draft('B'), isDirty: true, storageScope: 'user-1', baseSignature: 'sig' });
    vi.advanceTimersByTime(300);
    const latest = draft('C');
    saver.update({ draft: latest, isDirty: true, storageScope: 'user-1', baseSignature: 'sig' });
    vi.advanceTimersByTime(499);
    expect(write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(write).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith('user-1', latest, 'sig');
  });

  it('never writes after the draft closes (save or discard) and flushes on demand', () => {
    vi.useFakeTimers();
    const write = vi.fn();
    const saver = createSplitDraftAutosaver({ delayMs: 500, write });
    saver.update({ draft: draft('A'), isDirty: true, storageScope: 'user-1', baseSignature: null });
    saver.update({ draft: null, isDirty: false, storageScope: null, baseSignature: null });
    vi.advanceTimersByTime(1000);
    expect(write).not.toHaveBeenCalled();

    const pending = draft('B');
    saver.update({ draft: pending, isDirty: true, storageScope: 'user-1', baseSignature: null });
    saver.flush();
    expect(write).toHaveBeenCalledWith('user-1', pending, null);
    vi.advanceTimersByTime(1000);
    expect(write).toHaveBeenCalledOnce();
  });

  it('keeps nothing without an account', () => {
    vi.useFakeTimers();
    const write = vi.fn();
    const saver = createSplitDraftAutosaver({ delayMs: 10, write });
    saver.update({ draft: draft('A'), isDirty: true, storageScope: null, baseSignature: null });
    vi.advanceTimersByTime(100);
    expect(write).not.toHaveBeenCalled();
  });
});
