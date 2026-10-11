import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import { credentialPreview, RequestLabMetadata, requestCredentialPreview, type RequestLabCredentialMode } from "./RequestLabMetadata"

describe("RequestLabMetadata", () => {
  it("shows both identities and emits the three credential modes with a one-line description", async () => {
    const onModeChange = vi.fn()
    const user = userEvent.setup()

    function ControlledMetadata() {
      const [mode, setMode] = useState<RequestLabCredentialMode>("ORIGINAL")
      return <RequestLabMetadata service="https://api.example.test" identity="alice" observedCredential="Authorization: Bearer eyJh••••"
        requestRetained responseRetained={false} currentSession={{ label: "alice", credential: "Authorization: Bearer eyJk••••" }}
        credentialMode={mode} onCredentialModeChange={(next) => { onModeChange(next); setMode(next) }} />
    }
    render(<ControlledMetadata />)

    expect(screen.getByText("서비스: https://api.example.test")).toBeVisible()
    expect(screen.getByText("요청 보존 · 응답 미보존")).toBeVisible()
    expect(screen.getByText("Authorization: Bearer eyJh••••")).toBeVisible()
    expect(screen.getByText("Authorization: Bearer eyJk••••")).toBeVisible()
    expect(screen.getByText(/그대로 보내요/)).toBeVisible()
    await user.click(screen.getByRole("radio", { name: "현재 세션" }))
    expect(screen.getByText(/최신 인증값으로 바꿔서 보내요/)).toBeVisible()
    await user.click(screen.getByRole("radio", { name: "비로그인" }))
    expect(onModeChange.mock.calls).toEqual([["ACCOUNT"], ["ANONYMOUS"]])
    expect(screen.getByRole("button", { name: "현재 세션 설명" })).toBeVisible()
  })

  it("keeps the current session unavailable without a reusable session", () => {
    render(<RequestLabMetadata service="https://api.example.test" identity="alice" observedCredential={null} requestRetained responseRetained
      currentSession={null} credentialMode="ORIGINAL" onCredentialModeChange={vi.fn()} />)

    expect(screen.getByRole("radio", { name: "현재 세션" })).toBeDisabled()
    expect(screen.getByText("아직 저장된 최신 인증값이 없어요.")).toBeVisible()
    expect(screen.getByText("로그인 정보 없음")).toBeVisible()
  })

  it("masks all but a short prefix of the observed credential", () => {
    expect(credentialPreview(" Bearer eyJhbGciOiJIUzI1NiJ9.secret ")).toBe("Bearer eyJh••••")
    expect(credentialPreview("short")).toBe("••••")
    expect(requestCredentialPreview("GET / HTTP/1.1\r\nCookie: sid=abcdefghijklmnop\r\n")).toBe("Cookie: sid=••••")
    expect(requestCredentialPreview("GET / HTTP/1.1\r\nHost: x\r\n")).toBeNull()
  })
})
