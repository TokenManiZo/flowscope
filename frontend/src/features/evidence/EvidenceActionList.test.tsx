import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"
import type { EventRecord } from "@/lib/api/types"
import { targetSnapshot } from "@/test/fixtures"
import { EvidenceActionList } from "./EvidenceActionList"

const received = vi.hoisted(() => vi.fn())
vi.mock("./RequestLabDialog", () => ({ RequestLabDialog: ({ event }: { event: EventRecord }) => { received(event); return <div>원문 요청</div> } }))
afterEach(cleanup)

it("groups by collection card but passes the original authentication record to Request Lab", async () => {
  const event = { eventId: "e1", idn: "unresolved-cookie", fp: "ck:original", authState: "UNRESOLVED", collectionAccountId: "anon", op: "GET /items", resource: null, source: "human", method: "GET", path: "/items", status: 200, timestamp: 1 } as EventRecord
  render(<EvidenceActionList events={[event]} snapshot={targetSnapshot({ events: [event] })}
    identityOf={item => item.collectionAccountId!} labelIdentity={() => "비로그인"} />)
  expect(screen.getByRole("listitem", { name: "비로그인 관측 기록 1건" })).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "Request Lab에서 보내기" }))
  expect(received).toHaveBeenLastCalledWith(event)
  expect(received.mock.lastCall?.[0]).toMatchObject({ idn: "unresolved-cookie", fp: "ck:original", authState: "UNRESOLVED" })
})
