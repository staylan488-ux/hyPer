// The actions a held row offers, in the three forms the app shows them:
// iOS's context menu (native items with ids), an action sheet (a swipe's
// More, a build without the menu) and VoiceOver custom actions.

/**
 * One thing a held row offers. `children` makes a submenu (Move to → the
 * meals); `inline` shows those in place between separators instead.
 */
export type MenuAction = {
  title: string;
  run?: () => void;
  subtitle?: string;
  /** An SF Symbol, as iOS's own menus show beside each item. */
  symbol?: string;
  destructive?: boolean;
  disabled?: boolean;
  inline?: boolean;
  children?: MenuAction[];
};

/** A menu item as the native view reads it: no functions, an id per choice. */
export type MenuItem = Omit<MenuAction, 'run' | 'children'> & { id?: string; children?: MenuItem[] };

/** The native items, each choice with a path id ("1.0"), and what each id runs. */
export function menuItems(actions: MenuAction[]): { items: MenuItem[]; runs: Map<string, () => void> } {
  const runs = new Map<string, () => void>();
  const walk = (list: MenuAction[], path: string): MenuItem[] =>
    list.map((action, index) => {
      const id = `${path}${index}`;
      const { run, children, ...item } = action;
      if (children) return { ...item, children: walk(children, `${id}.`) };
      if (run) runs.set(id, run);
      return { ...item, id };
    });
  return { items: walk(actions, ''), runs };
}

/**
 * The choices one sheet (or VoiceOver's actions list) offers: inline groups
 * join the list, disabled items and empty submenus are left out. A submenu
 * stays one choice that asks again.
 */
export function sheetChoices(actions: MenuAction[]): MenuAction[] {
  return actions
    .flatMap((action) => (action.inline && action.children ? action.children : [action]))
    .filter((action) => !action.disabled && (!action.children || action.children.length > 0));
}
