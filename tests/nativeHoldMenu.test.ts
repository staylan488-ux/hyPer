import { describe, expect, it, vi } from 'vitest';

import { menuItems, sheetChoices, type MenuAction } from '../native/src/lib/menu';

describe('native hold menu items', () => {
  it('gives every choice a path id and runs the right one, submenus included', () => {
    const edit = vi.fn();
    const toLunch = vi.fn();
    const remove = vi.fn();
    const actions: MenuAction[] = [
      { title: 'Edit', symbol: 'pencil', run: edit },
      { title: 'Move to', children: [{ title: 'Breakfast', run: vi.fn() }, { title: 'Lunch', run: toLunch }] },
      { title: 'Delete', destructive: true, run: remove },
    ];
    const { items, runs } = menuItems(actions);

    expect(items).toEqual([
      { id: '0', title: 'Edit', symbol: 'pencil' },
      { title: 'Move to', children: [{ id: '1.0', title: 'Breakfast' }, { id: '1.1', title: 'Lunch' }] },
      { id: '2', title: 'Delete', destructive: true },
    ]);
    // Nothing the native view reads is a function.
    expect(JSON.parse(JSON.stringify(items))).toEqual(items);

    runs.get('1.1')?.();
    runs.get('2')?.();
    expect(toLunch).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(edit).not.toHaveBeenCalled();
  });

  it('offers a sheet the same choices: inline groups join, disabled and empty ones drop', () => {
    const actions: MenuAction[] = [
      { title: 'Rename', run: vi.fn() },
      { title: '', inline: true, children: [{ title: 'Move earlier', run: vi.fn() }, { title: 'Move later', run: vi.fn() }] },
      { title: 'Merge with', children: [] },
      { title: 'Sync now', disabled: true, run: vi.fn() },
      { title: 'Remove day', destructive: true, run: vi.fn() },
    ];

    expect(sheetChoices(actions).map((action) => action.title)).toEqual(['Rename', 'Move earlier', 'Move later', 'Remove day']);
  });

  it('tells the native menu which choices take the row away at once', () => {
    const { items } = menuItems([
      { title: 'Edit', run: vi.fn() },
      { title: 'Move to', children: [{ title: 'Lunch', removes: true, run: vi.fn() }] },
      { title: 'Delete', destructive: true, removes: true, run: vi.fn() },
    ]);
    expect(items[0].removes).toBeUndefined();
    expect(items[1].children?.[0]).toEqual({ id: '1.0', title: 'Lunch', removes: true });
    expect(items[2]).toEqual({ id: '2', title: 'Delete', destructive: true, removes: true });
  });

  it('keeps a submenu as one choice that asks again', () => {
    const move: MenuAction = { title: 'Move to', children: [{ title: 'Unassigned', run: vi.fn() }] };
    expect(sheetChoices([move])).toEqual([move]);
  });
});
