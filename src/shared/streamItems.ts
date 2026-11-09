// Incremental extraction of finished translation items from a response that is
// still streaming. A batch reply looks like
//   {"items":[{"id":"1","translated":"…"},{"id":"2","translated":"…"}]}
// and the whole point is to paint item 1 without waiting for item 8, so we scan
// the accumulated text for BALANCED objects and hand back the ones that parse
// into an {id, translated} pair. Deliberately not a full JSON parser: it only has
// to recognise complete objects, and anything it misses is picked up by the
// authoritative full parse once the stream ends.

export interface ItemScanState {
  /** How far into the accumulated buffer we have already scanned. */
  index: number;
  inString: boolean;
  escaped: boolean;
  /** Buffer offsets of every currently-open `{`. */
  starts: number[];
}

export interface ScannedItem {
  id: string;
  translated: string;
}

export function createItemScanState(): ItemScanState {
  return { index: 0, inString: false, escaped: false, starts: [] };
}

/**
 * Scan the newly-arrived tail of `buffer` and return the items that just became
 * complete. `buffer` must be the FULL accumulated text (offsets are absolute);
 * `state` is carried across calls and mutated.
 */
export function scanCompletedItems(buffer: string, state: ItemScanState): ScannedItem[] {
  const out: ScannedItem[] = [];

  for (let i = state.index; i < buffer.length; i += 1) {
    const char = buffer[i];

    if (state.inString) {
      if (state.escaped) state.escaped = false;
      else if (char === "\\") state.escaped = true;
      else if (char === '"') state.inString = false;
      continue;
    }

    if (char === '"') {
      state.inString = true;
    } else if (char === "{") {
      state.starts.push(i);
    } else if (char === "}") {
      const start = state.starts.pop();
      if (start === undefined) continue;
      const item = toItem(buffer.slice(start, i + 1));
      if (item) out.push(item);
    }
  }

  state.index = buffer.length;
  return out;
}

function toItem(text: string): ScannedItem | null {
  try {
    const parsed = JSON.parse(text) as { id?: unknown; translated?: unknown; translation?: unknown; text?: unknown };
    const id = parsed?.id;
    const translated = parsed?.translated ?? parsed?.translation ?? parsed?.text;
    if (id == null || typeof translated !== "string" || !translated) return null;
    return { id: String(id), translated };
  } catch {
    // Not a complete/valid item object (e.g. the outer {"items":[…]} wrapper).
    return null;
  }
}
