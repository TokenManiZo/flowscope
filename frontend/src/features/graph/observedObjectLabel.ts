import type { DisplayObject } from "@/lib/api/types"

/** Labels never identify objects; hashes and observation order remain unchanged. */
export function observedObjectLabel(object: DisplayObject): string {
  return object.integerLabel && /^-?\d+$/.test(object.integerLabel)
    ? object.integerLabel : `OBJ ${object.displayOrdinal || object.ordinal}`
}

export function observedObjectLocations(object: DisplayObject): string {
  const locations = object.locations?.length ? object.locations : [object.kind]
  if (locations.length < 2) return ""
  const order = ["PATH", "QUERY", "REQUEST_BODY", "RESPONSE_BODY"]
  return [...locations].sort((a, b) => order.indexOf(a) - order.indexOf(b))
    .map(kind => kind === "REQUEST_BODY" ? "BODY" : kind === "RESPONSE_BODY" ? "RESPONSE" : kind)
    .join(" · ")
}

export function observedObjectDisplayLabel(object: DisplayObject): string {
  const locations = observedObjectLocations(object)
  return `${observedObjectLabel(object)}${locations ? ` · ${locations}` : ""}`
}
