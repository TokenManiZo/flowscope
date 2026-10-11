import type { DisplayObject } from "@/lib/api/types"

/** Labels never identify objects; hashes and observation order remain unchanged. */
export function observedObjectLabel(object: DisplayObject): string {
  const label = object.integerLabel && /^-?\d+$/.test(object.integerLabel)
    ? object.integerLabel : `OBJ ${object.displayOrdinal || object.ordinal}`
  return label
}
