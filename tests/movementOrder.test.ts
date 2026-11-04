import { describe, expect, it } from 'vitest';
import { heldMovement, movementBlocks, movementScrollSpeed, moveMovementBlock, type ReorderMovement } from '@/lib/movementOrder';

const movement = (id: string, supersetGroupId?: string): ReorderMovement => ({ id, name: id, supersetGroupId });

describe('movement drag ordering', () => {
  it('moves directly across multiple movements and clamps either end', () => {
    const blocks = movementBlocks(['a', 'b', 'c', 'd'].map((id) => movement(id)));
    expect(moveMovementBlock(blocks, 'd', 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveMovementBlock(blocks, 'a', 20)).toEqual(['b', 'c', 'd', 'a']);
    expect(moveMovementBlock(blocks, 'a', -1)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keeps source and destination supersets together and preserves A/B order', () => {
    const blocks = movementBlocks([movement('a', 'pair1'), movement('b', 'pair1'), movement('c'), movement('d', 'pair2'), movement('e', 'pair2')]);
    expect(moveMovementBlock(blocks, 'b', 2)).toEqual(['c', 'd', 'e', 'a', 'b']);
    expect(moveMovementBlock(blocks, 'c', 0)).toEqual(['c', 'a', 'b', 'd', 'e']);
    expect(moveMovementBlock(blocks, 'c', 2)).toEqual(['a', 'b', 'd', 'e', 'c']);
  });

  it('handles an older nonadjacent pair without absorbing an unrelated movement', () => {
    const blocks = movementBlocks([movement('a', 'pair'), movement('x'), movement('b', 'pair'), movement('y')]);
    expect(moveMovementBlock(blocks, 'b', 2)).toEqual(['x', 'y', 'a', 'b']);
  });

  it('retains every movement for a missing source and does not mutate input', () => {
    const blocks = [['a'], ['b', 'c'], ['d']];
    expect(moveMovementBlock(blocks, 'missing', 0)).toEqual(['a', 'b', 'c', 'd']);
    moveMovementBlock(blocks, 'd', 0);
    expect(blocks).toEqual([['a'], ['b', 'c'], ['d']]);
  });
});

describe('dragging near scroll edges', () => {
  it('leaves normal dragging stationary and scrolls in the appropriate direction near either edge', () => {
    expect(movementScrollSpeed(400, 50, 750)).toBe(0);
    expect(movementScrollSpeed(60, 50, 750)).toBeLessThan(0);
    expect(movementScrollSpeed(740, 50, 750)).toBeGreaterThan(0);
    expect(movementScrollSpeed(740, 50, 750)).toBeGreaterThan(movementScrollSpeed(710, 50, 750));
  });

  it('caps scrolling outside the viewport and handles a viewport covered by the keyboard', () => {
    expect(movementScrollSpeed(-100, 50, 750)).toBe(-18);
    expect(movementScrollSpeed(900, 50, 750)).toBe(18);
    expect(movementScrollSpeed(400, 400, 400)).toBe(0);
    expect(movementScrollSpeed(400, 450, 400)).toBe(0);
  });
});

describe('holding a movement', () => {
  const blocks = movementBlocks([movement('a', 'pair1'), movement('b', 'pair1'), movement('c')]);

  it('opens the movement of a pair the finger is on, though the pair lifts as one', () => {
    expect(heldMovement(blocks, 'a', 'b')).toBe('b');
    expect(heldMovement(blocks, 'a', 'a')).toBe('a');
    expect(heldMovement(blocks, 'c', 'c')).toBe('c');
  });

  it('falls back to the held block\'s first movement when the touch belongs elsewhere', () => {
    expect(heldMovement(blocks, 'c', 'b')).toBe('c');
    expect(heldMovement(blocks, 'a', null)).toBe('a');
  });
});
