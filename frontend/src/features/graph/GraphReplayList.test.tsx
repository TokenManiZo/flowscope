import { screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"

import type { EventRecord, ManualVerification, Snapshot } from "@/lib/api/types"
import { targetSnapshot } from "@/test/fixtures"
import { renderWithQueryClient } from "@/test/render"
import { GraphReplayList } from "./GraphReplayList"

const replay: ManualVerification = { eventId: "replay-55", originEvidenceId: "original-7", operation: "https://api.example.test POST /orders/{id}", resource: "orders:7", identity: "alice", identityId: "acct-a", timestamp: 100, status: 200, durationMs: 12 }
const replayRecord = { eventId: replay.eventId, op: replay.operation, idn: replay.identityId, path: "/orders/7", method: "POST", status: 200, timestamp: 100 } as EventRecord
const snapshot: Snapshot = targetSnapshot({ datasetRevision: 3, events: [replayRecord], manualVerifications: [replay], evidenceOrdinals: { [replay.eventId]: 55 }, accounts: [{ id: "acct-a", label: "USER A", role: "user", target: "https://api.example.test", color: "", authArtifactCount: 0 }] })
afterEach(() => vi.unstubAllGlobals())

it.each([true, false])("reveals the clicked replay in the resend graph without opening raw, snapshot event present: %s", async present => {
  const fetch = vi.fn(), onRevealReplay = vi.fn()
  vi.stubGlobal("fetch", fetch)
  renderWithQueryClient(<GraphReplayList snapshot={{ ...snapshot, events: present ? [replayRecord] : [] }} items={[replay]} onRevealReplay={onRevealReplay} />)
  const button = within(screen.getByRole("region", { name: "Request Lab 재현" })).getByRole("button", { name: "#55 재전송 그래프에서 보기" })
  expect(button).toHaveTextContent("USER A")
  expect(button).toHaveTextContent("HTTP 200")
  await userEvent.click(button)
  expect(onRevealReplay).toHaveBeenCalledExactlyOnceWith(replay.eventId)
  expect(fetch).not.toHaveBeenCalled()
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
})

it("keeps the explanation behind the question-mark help beside the heading", async () => {
  renderWithQueryClient(<GraphReplayList snapshot={snapshot} items={[replay]} onRevealReplay={vi.fn()} />)
  const text = "원본 요청에 연결된 응답입니다. 상태 코드만으로 취약점을 판정하지 않습니다."
  expect(screen.queryByText(text)).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: "Request Lab 재현 도움말" }))
  expect(screen.getByText(text)).toBeVisible()
})

it("locks replay navigation when the snapshot is suspended", async () => {
  const onRevealReplay = vi.fn()
  renderWithQueryClient(<GraphReplayList snapshot={snapshot} items={[replay]} disabled onRevealReplay={onRevealReplay} />)
  const button = screen.getByRole("button", { name: "#55 재전송 그래프에서 보기" })
  expect(button).toBeDisabled()
  await userEvent.click(button)
  expect(onRevealReplay).not.toHaveBeenCalled()
})

it("does not offer a replay action without a graph navigation handler", () => {
  renderWithQueryClient(<GraphReplayList snapshot={snapshot} items={[replay]} />)
  expect(screen.getByRole("button", { name: "#55 재전송 그래프에서 보기" })).toBeDisabled()
})
