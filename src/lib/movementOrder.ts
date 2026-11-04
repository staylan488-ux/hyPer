export interface ReorderMovement {
  id: string;
  name: string;
  supersetGroupId?: string | null;
}

/** Treat pairs as blocks, preserving their A/B order even in an older split list. */
export function movementBlocks(items: ReorderMovement[]): string[][] {
  const seen = new Set<string>();
  const blocks: string[][] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    const block = item.supersetGroupId
      ? items.filter((candidate) => candidate.supersetGroupId === item.supersetGroupId).map((candidate) => candidate.id)
      : [item.id];
    block.forEach((id) => seen.add(id));
    blocks.push(block);
  }
  return blocks;
}

/** Destination is a boundary between the remaining blocks, never within a pair. */
export function moveMovementBlock(blocks: string[][], sourceId: string, destination: number): string[] {
  const source = blocks.find((block) => block.includes(sourceId));
  if (!source) return blocks.flat();
  const remaining = blocks.filter((block) => block !== source);
  remaining.splice(Math.max(0, Math.min(destination, remaining.length)), 0, source);
  return remaining.flat();
}

/** The movement a hold on a block opens: the one touched when it is in that block, else the block's first. */
export function heldMovement(blocks: string[][], key: string, touched: string | null): string {
  const block = blocks.find((entry) => entry[0] === key);
  return touched !== null && block?.includes(touched) ? touched : key;
}

export function movementScrollSpeed(pointerY: number, top: number, bottom: number): number {
  const edge = Math.min(64, Math.max(0, (bottom - top) / 4));
  if (!edge) return 0;
  if (pointerY < top + edge) return -18 * Math.min(1, (top + edge - pointerY) / edge);
  if (pointerY > bottom - edge) return 18 * Math.min(1, (pointerY - bottom + edge) / edge);
  return 0;
}
