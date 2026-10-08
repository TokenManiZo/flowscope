import type { EventRecord, Snapshot } from "@/lib/api/types"
import { identityLabel } from "@/lib/display/identityLabel"

/** The server attributes observations and decisions to the request-time selected session. */
export function collectionIdentity(event: EventRecord): string {
  return event.idn
}

export function graphAccountLabel(snapshot: Pick<Snapshot, "accounts">, identity: string): string {
  return identityLabel(identity, snapshot.accounts.find(account => account.id === identity)?.label ?? identity)
}

/** Registered identities remain visible even without access observations in the current graph. */
export function graphAccountIdentities(snapshot: Pick<Snapshot, "accounts" | "roles">): readonly string[] {
  return [...new Set([...snapshot.accounts.map(account => account.id), ...Object.keys(snapshot.roles), "anon"])].filter(Boolean)
}
