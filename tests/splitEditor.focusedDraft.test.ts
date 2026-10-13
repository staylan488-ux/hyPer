import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { cancelSplitEdit, saveSplitEdit } from '@/components/split/editor/editorActions';
import { SetRangeFields, type SetRangeFieldValues } from '@/components/split/SetRangeFields';
import { discardSplitEdit } from '@/lib/discardSplitEdit';

const editor = vi.hoisted(() => ({
  state: {
    draft: { id: 'split-1', name: 'Program', description: null, days: [] } as { id: string; name: string; description: null; days: never[]; _isNew?: boolean },
    isDirty: false, saving: false, error: null,
    renameSplit: vi.fn(), updateDescription: vi.fn(), addDay: vi.fn(),
    saveEdit: vi.fn(), cancelEdit: vi.fn(), discardEdit: vi.fn(),
  },
  confirm: vi.fn(async () => false),
  commit: vi.fn(),
  cellDraft: undefined as unknown,
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  // Only SetRangeFields owns state in this callback harness. The save and
  // cancel actions read the same live store before and after the input's real
  // blur handler runs.
  useState: (initial: unknown) => {
    if (editor.cellDraft === undefined) editor.cellDraft = initial;
    return [editor.cellDraft, (value: unknown) => { editor.cellDraft = value; }];
  },
}));
vi.mock('@/stores/splitEditStore', () => ({ useSplitEditStore: Object.assign(
  (selector: (state: typeof editor.state) => unknown) => selector(editor.state),
  { getState: () => editor.state },
) }));
vi.mock('@/lib/commitFocusedField', () => ({ commitFocusedField: editor.commit }));
vi.mock('@/lib/confirmDialog', () => ({ requestConfirm: editor.confirm }));

type Element = ReactElement<{ children?: ReactNode }>;
function nodes(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as Element;
  return [element, ...nodes(element.props.children)];
}
const createSplit = vi.fn();

/** Type the first edit without blurring; WebKit can leave this input focused. */
function typeMaxSets() {
  const values: SetRangeFieldValues = {
    target_sets_min: 2, target_sets: 3, target_sets_max: 4, target_reps_min: 8, target_reps_max: 12,
  };
  const props = {
    values,
    onCommitSets: (range: Pick<SetRangeFieldValues, 'target_sets_min' | 'target_sets' | 'target_sets_max'>) => {
      Object.assign(values, range);
      editor.state.isDirty = true;
    },
    onCommitReps: vi.fn(),
  };
  type Cell = ReactElement<{
    onChange: (event: { target: { value: string } }) => void;
    onBlur: () => void;
  }>;
  const maxCell = () => nodes(SetRangeFields(props)).filter((node) => node.type === 'input')[2] as Cell;
  maxCell().props.onChange({ target: { value: '5' } });
  const focused = maxCell();
  editor.commit.mockImplementation(() => focused.props.onBlur());
  return values;
}

beforeEach(() => {
  editor.state.isDirty = false;
  editor.state.saving = false;
  editor.state.draft._isNew = undefined;
  editor.cellDraft = undefined;
  editor.commit.mockReset();
  editor.state.saveEdit.mockReset().mockResolvedValue(true);
  editor.state.cancelEdit.mockReset();
  editor.state.discardEdit.mockReset();
  editor.confirm.mockReset().mockResolvedValue(false);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('program editor with a focused numeric draft', () => {
  it('allows the first numeric edit to be saved on one tap and includes its latest value', async () => {
    const values = typeMaxSets();
    const onSaved = vi.fn();
    const onClose = vi.fn();
    expect(editor.state.isDirty).toBe(false);
    expect(values.target_sets_max).toBe(4);
    let savedMax = 0;
    const saved = { id: 'split-1', name: 'Program', created: false };
    editor.state.saveEdit.mockImplementation(async () => { savedMax = values.target_sets_max; return saved; });
    await saveSplitEdit({ createSplit, onSaved, onClose });
    expect(savedMax).toBe(5);
    expect(editor.state.saveEdit).toHaveBeenCalledWith({ createSplit });
    expect(onSaved).toHaveBeenCalledWith(saved);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('commits before Cancel checks dirtiness and keeps the edit when discard is declined', async () => {
    const values = typeMaxSets();
    const onClose = vi.fn();
    await cancelSplitEdit(onClose);
    expect(values.target_sets_max).toBe(5);
    expect(editor.confirm).toHaveBeenCalledOnce();
    expect(editor.confirm.mock.calls[0]).toMatchObject([{ confirmLabel: 'Discard', destructive: true }]);
    expect(editor.state.discardEdit).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('uses the same focused-draft check for sheet close, including confirmed discard', async () => {
    typeMaxSets();
    expect(await discardSplitEdit()).toBe(false);
    expect(editor.state.discardEdit).not.toHaveBeenCalled();
    editor.confirm.mockResolvedValue(true);
    expect(await discardSplitEdit()).toBe(true);
    expect(editor.state.discardEdit).toHaveBeenCalledOnce();
  });

  it('closes an untouched draft without asking, keeping its device copy', async () => {
    expect(await discardSplitEdit()).toBe(true);
    expect(editor.confirm).not.toHaveBeenCalled();
    expect(editor.state.cancelEdit).toHaveBeenCalledOnce();
    expect(editor.state.discardEdit).not.toHaveBeenCalled();
  });

  it('closes an unchanged form without writing the program again', async () => {
    const onClose = vi.fn();
    const onSaved = vi.fn();
    await saveSplitEdit({ createSplit, onSaved, onClose });
    expect(editor.commit).toHaveBeenCalledOnce();
    expect(editor.state.saveEdit).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('always creates a new program, even one saved straight from its seed', async () => {
    editor.state.draft._isNew = true;
    const onClose = vi.fn();
    const onSaved = vi.fn();
    editor.state.saveEdit.mockResolvedValue({ id: 'created', name: 'Program', created: true });
    await saveSplitEdit({ createSplit, onSaved, onClose });
    expect(editor.state.saveEdit).toHaveBeenCalledOnce();
    expect(onSaved).toHaveBeenCalledWith({ id: 'created', name: 'Program', created: true });
  });

  it('keeps the sheet open when the save fails', async () => {
    typeMaxSets();
    const onClose = vi.fn();
    editor.state.saveEdit.mockResolvedValue(null);
    await saveSplitEdit({ createSplit, onSaved: vi.fn(), onClose });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not discard or submit again while a save runs', async () => {
    const onClose = vi.fn();
    editor.state.saving = true;
    await saveSplitEdit({ createSplit, onSaved: vi.fn(), onClose });
    expect(await discardSplitEdit()).toBe(false);
    expect(editor.commit).not.toHaveBeenCalled();
    expect(editor.state.saveEdit).not.toHaveBeenCalled();
    expect(editor.state.cancelEdit).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
