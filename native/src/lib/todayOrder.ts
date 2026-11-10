// The order of Today's groups, as the person arranged them (hold a group and
// drag it). Kept on this phone, per account: it is how this screen is laid
// out here, not part of the account's data.
import { create } from 'zustand';

export const TODAY_SECTIONS = ['training', 'fuel', 'progress'] as const;
export type TodaySection = (typeof TODAY_SECTIONS)[number];

const orderKey = (userId: string) => `hyper:today-order:${userId}`;

/** A kept order made whole: only known groups, each once, with any it lacks after them in the usual order. */
export function wholeTodayOrder(kept: unknown): TodaySection[] {
  const known = Array.isArray(kept) ? kept.filter((key): key is TodaySection => TODAY_SECTIONS.includes(key as TodaySection)) : [];
  const once = known.filter((key, index) => known.indexOf(key) === index);
  return [...once, ...TODAY_SECTIONS.filter((key) => !once.includes(key))];
}

/** The order with one group set down at `index`. */
export function movedTodayOrder(order: TodaySection[], key: TodaySection, index: number): TodaySection[] {
  const rest = order.filter((other) => other !== key);
  rest.splice(Math.max(0, Math.min(index, rest.length)), 0, key);
  return rest;
}

const USUAL: TodaySection[] = [...TODAY_SECTIONS];

/** What this phone keeps for an account, read once a launch. */
const kept = new Map<string, TodaySection[]>();
function keptOrder(userId: string): TodaySection[] {
  let order = kept.get(userId);
  if (!order) {
    try {
      const saved = globalThis.localStorage?.getItem(orderKey(userId));
      order = wholeTodayOrder(saved ? JSON.parse(saved) : null);
    } catch {
      order = USUAL;
    }
    kept.set(userId, order);
  }
  return order;
}

/** Each account's order as changed this launch. */
const useOrders = create<{ orders: Record<string, TodaySection[]> }>(() => ({ orders: {} }));

/**
 * Today's groups in the signed-in account's order; the usual order until
 * someone is signed in. Read on the first render that asks, so the page
 * opens in its order, with no jump.
 */
export function useTodayOrder(userId: string | null): TodaySection[] {
  return useOrders((state) => (userId ? (state.orders[userId] ?? keptOrder(userId)) : USUAL));
}

/** An account's order now: as changed this launch, or as this phone keeps it. */
export function todayOrderOf(userId: string): TodaySection[] {
  return useOrders.getState().orders[userId] ?? keptOrder(userId);
}

/** A group was set down at `index`: the new order shows at once and is kept. */
export function moveTodaySection(userId: string | null, key: TodaySection, index: number) {
  if (!userId) return;
  const order = movedTodayOrder(todayOrderOf(userId), key, index);
  useOrders.setState((state) => ({ orders: { ...state.orders, [userId]: order } }));
  try {
    globalThis.localStorage?.setItem(orderKey(userId), JSON.stringify(order));
  } catch {
    // holds until the app closes
  }
}
