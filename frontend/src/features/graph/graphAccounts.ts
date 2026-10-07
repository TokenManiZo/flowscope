import type { EventRecord, Snapshot } from "@/lib/api/types"
import { identityLabel } from "@/lib/display/identityLabel"

/** The server attributes observations and decisions to the request-time selected session. */
export function collectionIdentity(event: EventRecord): string {
  return event.idn
}

export function graphAccountLabel(snapshot: Pick<Snapshot, "accounts">, identity: string): string {
  return identityLabel(identity, snapshot.accounts.find(account => account.id === identity)?.label ?? identity)
}
