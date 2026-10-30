import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import type { ColorValue, NativeSyntheticEvent, ViewProps } from 'react-native';

/** One menu item as the native view reads it; `children` makes a submenu. */
export type NativeMenuItem = {
  id?: string;
  title: string;
  subtitle?: string;
  /** An SF Symbol name. */
  symbol?: string;
  destructive?: boolean;
  disabled?: boolean;
  /** Runs as the menu closes, the lifted row fading in place (it leaves its list). */
  removes?: boolean;
  /** A submenu shown in place, between separators, rather than behind a row. */
  inline?: boolean;
  children?: NativeMenuItem[];
};

export type HyperMenuViewProps = ViewProps & {
  actions: NativeMenuItem[];
  previewColor?: ColorValue;
  previewRadius?: number;
  enabled?: boolean;
  onAction?: (event: NativeSyntheticEvent<{ id: string }>) => void;
  onOpen?: () => void;
};

/** False in a build without the module (an older binary): holds fall back to an action sheet. */
export const hasHyperMenu = requireOptionalNativeModule('HyperMenu') != null;

/** A view that offers iOS's context menu when held, lifting itself as the preview. */
export const HyperMenuView: ComponentType<HyperMenuViewProps> | null = hasHyperMenu ? requireNativeView<HyperMenuViewProps>('HyperMenu') : null;
