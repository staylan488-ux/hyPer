import type { ReactNode } from 'react';
import { ActionSheetIOS, View, type StyleProp, type ViewStyle } from 'react-native';

import { HyperMenuView, hasHyperMenu, type NativeMenuItem } from '../../modules/hyper-menu';
import { radius, useBlanc } from '~/theme/blanc';

import { dismissOpenSwipeRow } from './SwipeRow';

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

/** Whether this build has iOS's context menus (an older binary falls back to an action sheet). */
export const hasHoldMenu = hasHyperMenu;

function toNative(actions: MenuAction[], prefix = ''): { items: NativeMenuItem[]; runs: Map<string, () => void> } {
  const runs = new Map<string, () => void>();
  const walk = (list: MenuAction[], path: string): NativeMenuItem[] =>
    list.map((action, index) => {
      const id = `${path}${index}`;
      const { run, children, ...item } = action;
      if (children) return { ...item, children: walk(children, `${id}.`) };
      if (run) runs.set(id, run);
      return { ...item, id };
    });
  return { items: walk(actions, prefix), runs };
}

/**
 * Wraps a row so a hold opens iOS's context menu: the row lifts out of its
 * list, the screen behind blurs and the actions show beside it, with iOS's
 * own haptic. A choice runs once the menu has closed and the row is back.
 * Opening it closes a row left swiped open. Without the native menu (an
 * older build) it is a plain view, and the row offers `showActionSheet`
 * on its long press instead.
 */
export function HoldMenu({ actions, enabled = true, style, children }: {
  actions: MenuAction[];
  enabled?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const c = useBlanc();
  if (!HyperMenuView || actions.length === 0) return <View style={style}>{children}</View>;
  const { items, runs } = toNative(actions);
  return (
    <HyperMenuView
      style={style}
      actions={items}
      enabled={enabled}
      previewColor={c.label}
      previewRadius={radius.label}
      onOpen={() => {
        dismissOpenSwipeRow();
      }}
      onAction={(event) => runs.get(event.nativeEvent.id)?.()}>
      {children}
    </HyperMenuView>
  );
}

/**
 * The same actions as an action sheet: for a swipe's More, a ⋯ button, and
 * holds in a build without the native menu. A submenu opens a second sheet;
 * inline items join the first.
 */
export function showActionSheet(title: string | undefined, actions: MenuAction[], message?: string) {
  const flat = actions.flatMap((action) => (action.inline && action.children ? action.children : [action])).filter((action) => !action.disabled);
  if (flat.length === 0) return;
  const destructive = flat.flatMap((action, index) => (action.destructive ? [index] : []));
  ActionSheetIOS.showActionSheetWithOptions(
    {
      title,
      message,
      // A submenu's title gets the ellipsis of a choice that asks again.
      options: [...flat.map((action) => (action.children ? `${action.title}…` : action.title)), 'Cancel'],
      cancelButtonIndex: flat.length,
      destructiveButtonIndex: destructive.length > 0 ? destructive : undefined,
    },
    (index) => {
      const action = flat[index];
      if (!action) return;
      if (action.children) showActionSheet(action.title, action.children);
      else action.run?.();
    },
  );
}

/**
 * The actions as VoiceOver custom actions on the row, one per item; a
 * submenu is one action that opens its choices as a sheet.
 */
export function menuAccessibility(actions: MenuAction[]) {
  const flat = actions.flatMap((action) => (action.inline && action.children ? action.children : [action])).filter((action) => !action.disabled);
  return {
    actions: flat.map((action, index) => ({ name: `menu:${index}`, label: action.title })),
    run: (name: string) => {
      if (!name.startsWith('menu:')) return false;
      const action = flat[Number(name.slice(5))];
      if (action?.children) showActionSheet(action.title, action.children);
      else action?.run?.();
      return true;
    },
  };
}
