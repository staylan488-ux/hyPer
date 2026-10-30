import type { ReactNode } from 'react';
import { ActionSheetIOS, View, type StyleProp, type ViewStyle } from 'react-native';

import { HyperMenuView, hasHyperMenu } from '../../modules/hyper-menu';
import { menuItems, sheetChoices, type MenuAction } from '~/lib/menu';
import { radius, useBlanc } from '~/theme/blanc';

import { dismissOpenSwipeRow } from './SwipeRow';

export type { MenuAction } from '~/lib/menu';

/** Whether this build has iOS's context menus (an older binary falls back to an action sheet). */
export const hasHoldMenu = hasHyperMenu;

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
  const { items, runs } = menuItems(actions);
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
 * The same actions as an action sheet: for a swipe's More, a tap that shows
 * choices, and holds in a build without the native menu. A submenu opens a
 * second sheet; inline items join the first.
 */
export function showActionSheet(title: string | undefined, actions: MenuAction[], message?: string) {
  const choices = sheetChoices(actions);
  if (choices.length === 0) return;
  const destructive = choices.flatMap((action, index) => (action.destructive ? [index] : []));
  ActionSheetIOS.showActionSheetWithOptions(
    {
      title,
      message,
      // A submenu's title gets the ellipsis of a choice that asks again.
      options: [...choices.map((action) => (action.children ? `${action.title}…` : action.title)), 'Cancel'],
      cancelButtonIndex: choices.length,
      destructiveButtonIndex: destructive.length > 0 ? destructive : undefined,
    },
    (index) => {
      const action = choices[index];
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
  const choices = sheetChoices(actions);
  return {
    actions: choices.map((action, index) => ({ name: `menu:${index}`, label: action.title })),
    run: (name: string) => {
      if (!name.startsWith('menu:')) return false;
      const action = choices[Number(name.slice(5))];
      if (action?.children) showActionSheet(action.title, action.children);
      else action?.run?.();
      return true;
    },
  };
}
