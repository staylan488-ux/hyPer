import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { SplitEditor } from '@/components/split/SplitEditor';
import { SetRangeFields, type SetRangeFieldValues } from '@/components/split/SetRangeFields';
import { discardSplitEdit } from '@/lib/discardSplitEdit';

const editor = vi.hoisted(() => ({
  state: {
    draft: { id: 'split-1', name: 'Program', description: null, days: [] },
    isDirty: false, saving: false, error: null,
    renameSplit: vi.fn(), updateDescription: vi.fn(), addDay: vi.fn(),
    saveEdit: vi.fn(), cancelEdit: vi.fn(),
  },
  commit: vi.fn(),
  cellDraft: undefined as unknown,
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useCallback: <T>(callback: T) => callback,
  // Only SetRangeFields owns state in this callback harness. SplitEditor reads
  // the same live store before and after the input's real blur handler runs.
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
vi.mock('@/components/shared', () => ({ Button: 'button', Input: 'input', Card: 'div' }));
vi.mock('motion/react', () => ({
  motion: { div: 'div', button: 'button', p: 'p' }, AnimatePresence: 'div', LayoutGroup: 'div',
}));

type Element = ReactElement<{ children?: ReactNode; value?: string; disabled?: boolean; onClick?: () => void | Promise<void> }>;
function nodes(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as Element;
  return [element, ...nodes(element.props.children)];
}
function action(tree: ReactNode, label: string) {
  return nodes(tree).find((node) => node.type === 'button' && node.props.children === label)!;
}

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
  editor.cellDraft = undefined;
  editor.commit.mockReset();
  editor.state.saveEdit.mockReset().mockResolvedValue(true);
  editor.state.cancelEdit.mockReset();
  vi.stubGlobal('window', { confirm: vi.fn(() => false) });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('program editor with a focused numeric draft', () => {
  it('allows the first numeric edit to be saved on one tap and includes its latest value', async () => {
    const values = typeMaxSets();
    const onSaved = vi.fn();
    const onClose = vi.fn();
    const tree = SplitEditor({ onSaved, onClose, onPickExercise: vi.fn() });
    expect(editor.state.isDirty).toBe(false);
    expect(values.target_sets_max).toBe(4);
    expect(action(tree, 'Save').props.disabled).toBe(false);
    let savedMax = 0;
    editor.state.saveEdit.mockImplementation(async () => { savedMax = values.target_sets_max; return true; });
    await action(tree, 'Save').props.onClick!();
    expect(savedMax).toBe(5);
    expect(onSaved).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('commits before Cancel checks dirtiness and keeps the edit when discard is declined', () => {
    const values = typeMaxSets();
    const onClose = vi.fn();
    const tree = SplitEditor({ onClose, onSaved: vi.fn(), onPickExercise: vi.fn() });
    action(tree, 'Cancel').props.onClick!();
    expect(values.target_sets_max).toBe(5);
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(editor.state.cancelEdit).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('uses the same focused-draft check for sheet close, including confirmed discard', () => {
    typeMaxSets();
    expect(discardSplitEdit()).toBe(false);
    expect(editor.state.cancelEdit).not.toHaveBeenCalled();
    vi.mocked(window.confirm).mockReturnValue(true);
    expect(discardSplitEdit()).toBe(true);
    expect(editor.state.cancelEdit).toHaveBeenCalledOnce();
  });

  it('closes an unchanged form without writing the program again', async () => {
    const onClose = vi.fn();
    const onSaved = vi.fn();
    const tree = SplitEditor({ onClose, onSaved, onPickExercise: vi.fn() });
    await action(tree, 'Save').props.onClick!();
    expect(editor.commit).toHaveBeenCalledOnce();
    expect(editor.state.saveEdit).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not discard or submit again while a save runs', async () => {
    const onClose = vi.fn();
    const tree = SplitEditor({ onClose, onSaved: vi.fn(), onPickExercise: vi.fn() });
    editor.state.saving = true;
    await action(tree, 'Save').props.onClick!();
    expect(discardSplitEdit()).toBe(false);
    expect(editor.commit).not.toHaveBeenCalled();
    expect(editor.state.saveEdit).not.toHaveBeenCalled();
    expect(editor.state.cancelEdit).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
