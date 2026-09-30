import { describe, expect, it } from 'vitest';
import { createPendingEntryId, entryWriteId } from '@/lib/pendingEntryId';

function sequentialIds() {
  let next = 0;
  return () => `entry-${++next}`;
}

describe('pending nutrition entry id', () => {
  it('keeps the same id across a failed save and its retry', () => {
    const pending = createPendingEntryId(sequentialIds());

    const first = entryWriteId(false, undefined, pending);
    // the save failed (maybe after committing), so nothing clears the id
    const retry = entryWriteId(false, undefined, pending);

    expect(first).toBe('entry-1');
    expect(retry).toBe('entry-1');
  });

  it('uses a new id after a confirmed save', () => {
    const pending = createPendingEntryId(sequentialIds());

    expect(entryWriteId(false, undefined, pending)).toBe('entry-1');
    pending.clear();
    expect(entryWriteId(false, undefined, pending)).toBe('entry-2');
  });

  it('gives each item of a sequential multi-item log its own id', () => {
    const pending = createPendingEntryId(sequentialIds());
    const written: (string | undefined)[] = [];

    for (let item = 0; item < 3; item += 1) {
      written.push(entryWriteId(false, undefined, pending));
      pending.clear();
    }

    expect(written).toEqual(['entry-1', 'entry-2', 'entry-3']);
  });

  it('never assigns a pending id when editing an existing entry', () => {
    const pending = createPendingEntryId(sequentialIds());

    expect(entryWriteId(true, undefined, pending)).toBeUndefined();
    // a later new entry still starts from the first generated id
    expect(entryWriteId(false, undefined, pending)).toBe('entry-1');
  });

  it('lets an explicit retry id win without consuming the pending id', () => {
    const pending = createPendingEntryId(sequentialIds());

    expect(entryWriteId(false, 'trial-7', pending)).toBe('trial-7');
    expect(entryWriteId(true, 'trial-7', pending)).toBe('trial-7');
    expect(entryWriteId(false, undefined, pending)).toBe('entry-1');
  });

  it('generates UUIDs by default', () => {
    const pending = createPendingEntryId();
    expect(pending.take()).toMatch(/^[0-9a-f-]{36}$/);
  });
});
