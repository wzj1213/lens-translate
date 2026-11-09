export interface BatchLimits {
  batchMaxItems: number;
  batchMaxChars: number;
}

/**
 * Pack items into batches bounded by item count and total character length.
 * A single oversized item still gets its own batch (never dropped).
 */
export function packBatches<T extends { text: string }>(items: T[], limits: BatchLimits): T[][] {
  const maxItems = Math.max(1, limits.batchMaxItems);
  const maxChars = Math.max(1, limits.batchMaxChars);
  const batches: T[][] = [];
  let batch: T[] = [];
  let chars = 0;

  for (const item of items) {
    const itemChars = item.text.length;
    const exceedsCount = batch.length >= maxItems;
    const exceedsChars = batch.length > 0 && chars + itemChars > maxChars;
    if (exceedsCount || exceedsChars) {
      batches.push(batch);
      batch = [];
      chars = 0;
    }
    batch.push(item);
    chars += itemChars;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}
