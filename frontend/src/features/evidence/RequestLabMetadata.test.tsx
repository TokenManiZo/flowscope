import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import { RequestLabMetadata, type RequestLabCredentialMode } from "./RequestLabMetadata"
import type { ManagedSession } from "@/lib/api/types"

const activeAccount: ManagedSession = {
  handle: "opaque-handle",
  accountId: "acct-1",
  accountLabel: "관리자",
  service: "https://api.example.test",
  status: "ACTIVE",
  createdAt: "now",
  lastUsedAt: null,
  expiresAtHint: null,
  hasAuthorization: true,
  cookieCount: 1,
  capturing: false,
  credentialConflict: false,
}

describe("RequestLabMetadata", () => {
  it("renders exact draft metadata and emits controlled credential changes", async () => {
    const onModeChange = vi.fn()
    const onAccountChange = vi.fn()
    const user = userEvent.setup()

    function ControlledMetadata() {
      const [mode, setMode] = useState<RequestLabCredentialMode>("ORIGINAL")
      const [accountId, setAccountId] = useState("")
      return <RequestLabMetadata
        service="https://api.example.test"
        identity="alice"
        requestRetained
        responseRetained={false}
        requestCharset="UTF-8"
        responseCharset="ISO-8859-1"
        requestEditable
        sessionStatus="managed"
        credentialMode={mode}
        eligibleAccounts={[activeAccount]}
        selectedAccountId={accountId}
        onCredentialModeChange={(nextMode) => { onModeChange(nextMode); setMode(nextMode) }}
        onAccountChange={(nextAccountId) => { onAccountChange(nextAccountId); setAccountId(nextAccountId) }}
      />
    }

    render(<ControlledMetadata />)

    expect(screen.getByRole("region", { name: "Request Lab 메타데이터" })).toBeVisible()
    expect(screen.getByText("서비스: https://api.example.test")).toBeVisible()
    expect(screen.getByText("alice")).toBeVisible()
    expect(screen.getByText("요청 보존 · 응답 미보존")).toBeVisible()
    expect(screen.getByText("UTF-8 / ISO-8859-1")).toBeVisible()
    expect(screen.getByText("managed")).toBeVisible()
    expect(screen.queryByLabelText("계정")).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText("자격 증명 모드"), "ACCOUNT")
    await user.selectOptions(screen.getByLabelText("계정"), "acct-1")
    expect(screen.getByLabelText("계정")).toHaveValue("acct-1")
    await user.selectOptions(screen.getByLabelText("자격 증명 모드"), "ANONYMOUS")
    expect(screen.queryByLabelText("계정")).not.toBeInTheDocument()

    expect(onModeChange).toHaveBeenNthCalledWith(1, "ACCOUNT")
    expect(onModeChange).toHaveBeenNthCalledWith(2, "ANONYMOUS")
    expect(onAccountChange).toHaveBeenCalledWith("acct-1")
  })

  it("keeps ACCOUNT unavailable when there is no eligible active session", () => {
    render(<RequestLabMetadata
      service="https://api.example.test"
      identity="alice"
      requestRetained
      responseRetained
      requestCharset={null}
      responseCharset={null}
      requestEditable
      sessionStatus="없음"
      credentialMode="ORIGINAL"
      eligibleAccounts={[]}
      selectedAccountId=""
      onCredentialModeChange={vi.fn()}
      onAccountChange={vi.fn()}
    />)

    expect(screen.getByRole("option", { name: "ACCOUNT" })).toBeDisabled()
    expect(screen.getByText(/ACTIVE 재사용 세션/)).toBeVisible()
    expect(screen.queryByLabelText("계정")).not.toBeInTheDocument()
  })
})
