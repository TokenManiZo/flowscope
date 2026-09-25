import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, afterEach, describe, expect, it, vi } from "vitest"

import { AccountsPage } from "./AccountsPage"
import { createTestQueryClient, renderWithQueryClient } from "@/test/render"
import { snapshotFixture } from "@/test/fixtures"

const service = "https://demo.flowscope.test:443"
const rawSecret = "raw-cookie authorization bearer capability password"
const secretSentinels = [rawSecret, "snapshot-password", "snapshot-cookie", "snapshot-authorization"]

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    ...snapshotFixture,
    roles: { "observed-user": "User" },
    accounts: [
      { id: "account-a", label: "계정 A", role: "User", target: service, color: "", authArtifactCount: 1 },
      { id: "other-service", label: "다른 서비스", role: "Admin", target: "https://other.example.test:443", color: "", authArtifactCount: 0 },
    ],
    sessions: [
      { fingerprint: "ck:one-way-fingerprint", idn: "observed-user", accountId: null, artifactKind: "COOKIE", evidence: "evidence-1", confidence: "UNASSIGNED", firstSeen: 0, lastSeen: 0, registered: false, service, rawCredential: rawSecret, password: "snapshot-password", cookie: "snapshot-cookie", authorization: "snapshot-authorization" },
      { fingerprint: "ck:bound-fingerprint", idn: "bound-user", accountId: "account-a", artifactKind: "AUTHORIZATION", evidence: "evidence-2", confidence: "MANUAL", firstSeen: 0, lastSeen: 0, registered: true, service },
    ],
    managedSessions: [
      { handle: "active-handle", accountId: "account-a", accountLabel: "계정 A", service, status: "ACTIVE", verificationSource: "OPERATOR_ASSERTED", createdAt: "", lastUsedAt: null, expiresAtHint: null, hasAuthorization: true, cookieCount: 1, capturing: false, credentialConflict: false, credential: rawSecret },
      { handle: "capturing-handle", accountId: "capturing-account", accountLabel: "캡처 중", service, status: "CAPTURING", createdAt: "", lastUsedAt: null, expiresAtHint: null, hasAuthorization: false, cookieCount: 0, capturing: true, credentialConflict: false },
      { handle: "unverified-handle", accountId: "unverified-account", accountLabel: "확인 필요", service, status: "UNVERIFIED", createdAt: "", lastUsedAt: null, expiresAtHint: null, hasAuthorization: true, cookieCount: 1, capturing: false, credentialConflict: false },
      { handle: "revoked-handle", accountId: "revoked-account", accountLabel: "폐기됨", service, status: "REVOKED", createdAt: "", lastUsedAt: null, expiresAtHint: null, hasAuthorization: false, cookieCount: 0, capturing: false, credentialConflict: false },
      { handle: "conflict-handle", accountId: "conflict-account", accountLabel: "충돌", service, status: "ACTIVE", createdAt: "", lastUsedAt: null, expiresAtHint: null, hasAuthorization: true, cookieCount: 1, capturing: false, credentialConflict: true },
    ],
    ...overrides,
  }
}

function renderAccounts(options: { postError?: Partial<Record<string, string>>; snapshot?: Record<string, unknown>; pendingPath?: string } = {}) {
  const meta = document.createElement("meta")
  meta.name = "flowscope-capability"
  meta.content = rawSecret
  document.head.append(meta)
  const fetchStub = vi.fn((path: string, init?: RequestInit) => {
    if (path === "/api/snapshot") return Promise.resolve(response(snapshot(options.snapshot)))
    if (init?.method === "POST") {
      const message = options.postError?.[path]
      if (options.pendingPath === path) return new Promise<Response>(() => undefined)
      return Promise.resolve(message ? response({ success: false, message }, 400) : response({ success: true, message: `${path} 완료`, id: "saved-account", rebound: 0 }))
    }
    return Promise.reject(new Error(`unexpected endpoint: ${path} ${init?.method ?? "GET"}`))
  })
  vi.stubGlobal("fetch", fetchStub)
  const rendered = renderWithQueryClient(<AccountsPage />, createTestQueryClient())
  return { ...rendered, fetchStub }
}

function setCompactViewport(width: number) {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    matches: query.includes("1279") && width < 1280,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: () => true,
  })) as unknown as typeof window.matchMedia)
}

function snapshotReads(fetchStub: ReturnType<typeof vi.fn>) {
  return fetchStub.mock.calls.filter(([path]) => path === "/api/snapshot").length
}

function postBodies(fetchStub: ReturnType<typeof vi.fn>, path: string) {
  return fetchStub.mock.calls
    .filter(([calledPath, init]) => calledPath === path && (init as RequestInit).method === "POST")
    .map(([, init]) => ((init as RequestInit).body as URLSearchParams).toString())
}

async function choose(user: ReturnType<typeof userEvent.setup>, name: string, option: string) {
  await user.click(screen.getByRole("combobox", { name }))
  await user.click(await screen.findByRole("option", { name: option }))
}

function renderedAttributeValues() {
  return [...document.querySelectorAll("[title], [aria-label]")].flatMap((element) => [element.getAttribute("title") ?? "", element.getAttribute("aria-label") ?? ""])
}

function storedValues(storage: Storage) {
  return Array.from({ length: storage.length }, (_, index) => storage.getItem(storage.key(index) ?? "") ?? "")
}

function postedFormValues(fetchStub: ReturnType<typeof vi.fn>) {
  return fetchStub.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === "POST")
    .map(([, init]) => new URLSearchParams((init as RequestInit).body as URLSearchParams))
}

afterEach(() => {
  document.head.querySelector('meta[name="flowscope-capability"]')?.remove()
  vi.unstubAllGlobals()
  localStorage.clear()
  sessionStorage.clear()
})

const previousHasPointerCapture = Object.getOwnPropertyDescriptor(Element.prototype, "hasPointerCapture")
const previousScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView")

if (!previousHasPointerCapture) {
  Object.defineProperty(Element.prototype, "hasPointerCapture", { configurable: true, value: () => false })
}
if (!previousScrollIntoView) {
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: () => undefined })
}

afterAll(() => {
  if (previousHasPointerCapture) Object.defineProperty(Element.prototype, "hasPointerCapture", previousHasPointerCapture)
  else delete (Element.prototype as { hasPointerCapture?: unknown }).hasPointerCapture
  if (previousScrollIntoView) Object.defineProperty(Element.prototype, "scrollIntoView", previousScrollIntoView)
  else delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
})

describe("account and session management", () => {
  it("shows the verification-source badge on a strongly verified managed session", async () => {
    renderAccounts()
    await screen.findByRole("heading", { name: "계정·세션 관리" })
    // account-a's managed session is ACTIVE + OPERATOR_ASSERTED → operator-confirmed badge.
    expect(await screen.findByText("운영자 확인")).toBeVisible()
  })

  it("sends exact registered-account save fields and retains an edit on the action-local server error", async () => {
    const user = userEvent.setup()
    const { fetchStub } = renderAccounts({ postError: { "/api/account-save": "저장할 수 없습니다." } })

    await screen.findByRole("heading", { name: "계정·세션 관리" })
    expect(screen.queryByRole("button", { name: "계정 A 수정" })).not.toBeInTheDocument()
    await user.type(screen.getByLabelText("등록 계정 표시 이름"), "변경 계정")
    await user.type(screen.getByLabelText("등록 계정 대상 서비스"), service)
    await user.click(screen.getByRole("button", { name: "계정 저장" }))

    await waitFor(() => expect(postBodies(fetchStub, "/api/account-save")).toEqual([new URLSearchParams({ id: "", label: "변경 계정", role: "User", target: service }).toString()]))
    expect(await screen.findByRole("alert", { name: "저장할 수 없습니다." })).toBeVisible()
    expect(screen.getByLabelText("등록 계정 표시 이름")).toHaveValue("변경 계정")
    expect(screen.getByLabelText("등록 계정 역할")).toHaveTextContent("User")
    expect(screen.getByLabelText("등록 계정 대상 서비스")).toHaveValue(service)
    expect(screen.getByRole("button", { name: "계정 A 수정 패널" })).toBeVisible()
  })

  it("confirmation-gates deletion, blocks bound accounts locally, and sends an unbound deletion only after confirmation", async () => {
    const user = userEvent.setup()
    const { fetchStub } = renderAccounts()

    await screen.findByRole("heading", { name: "계정·세션 관리" })
    expect(screen.getByText("연결된 세션을 먼저 해제하세요.")).toBeVisible()
    expect(screen.queryByRole("button", { name: "계정 A 삭제" })).not.toBeInTheDocument()
    expect(postBodies(fetchStub, "/api/account-delete")).toEqual([])
    await user.click(screen.getByRole("button", { name: "다른 서비스 삭제" }))
    expect(postBodies(fetchStub, "/api/account-delete")).toEqual([])
    await user.click(await screen.findByRole("button", { name: "계정 삭제 확인" }))
    await waitFor(() => expect(postBodies(fetchStub, "/api/account-delete")).toEqual(["id=other-service"]))
  })

  it("keeps observed identity roles and same-service identity merge separate from account editing", async () => {
    const user = userEvent.setup()
    const { fetchStub } = renderAccounts()

    await screen.findByText("관측 신원 역할")
    await user.click(screen.getByRole("button", { name: "관측 신원 역할 열기" }))
    await user.click(screen.getByRole("button", { name: "관측 신원 역할 저장" }))
    await waitFor(() => expect(postBodies(fetchStub, "/api/role")).toEqual(["identity=observed-user&role=User"]))
    await user.click(screen.getByRole("combobox", { name: "병합 대상 등록 계정" }))
    expect(await screen.findByRole("option", { name: "계정 A" })).toBeVisible()
    expect(screen.queryByRole("option", { name: "다른 서비스" })).not.toBeInTheDocument()
    await user.keyboard("{Escape}")
    await user.click(screen.getByRole("button", { name: "같은 사용자로 병합" }))
    await waitFor(() => expect(postBodies(fetchStub, "/api/identity-merge")).toEqual(["from=observed-user&into=account-a"]))
  })

  it("rejects equal identity merge in the UI before transport", async () => {
    const user = userEvent.setup()
    const { fetchStub } = renderAccounts({ snapshot: { accounts: [{ id: "observed-user", label: "동일 id", role: "User", target: service, color: "", authArtifactCount: 0 }] } })

    await screen.findByRole("heading", { name: "계정·세션 관리" })
    expect(screen.getByRole("button", { name: "같은 사용자로 병합" })).toBeDisabled()
    expect(screen.getByText("서로 다른 두 신원을 선택하세요.")).toBeVisible()
    expect(postBodies(fetchStub, "/api/identity-merge")).toEqual([])
  })

  it("binds only a service-matched account, unbinds the observed fingerprint, and renders managed diagnostic states", async () => {
    const user = userEvent.setup()
    const { fetchStub } = renderAccounts()

    await screen.findAllByText("ACTIVE")
    expect(screen.getByText(/계정마다 별도 브라우저 프로필 또는 독립 브라우저 컨텍스트를 사용하세요/)).toBeVisible()
    expect(screen.getAllByText("ACTIVE")[0]).toBeVisible()
    for (const text of ["CAPTURING", "UNVERIFIED", "REVOKED", "credential-conflict"]) expect(screen.getAllByText(text)[0]).toBeVisible()
    await user.click(screen.getByRole("button", { name: "고급 세션 진단 열기" }))
    await choose(user, "관측 세션 1 연결 계정", "계정 A")
    await user.click(screen.getByRole("button", { name: "관측 세션 1 연결" }))
    await waitFor(() => expect(postBodies(fetchStub, "/api/session-bind")).toEqual([`service=${encodeURIComponent(service)}&fingerprint=ck%3Aone-way-fingerprint&account=account-a`]))
    await user.click(screen.getByRole("button", { name: "관측 세션 2 연결 해제" }))
    await waitFor(() => expect(postBodies(fetchStub, "/api/session-unbind")).toEqual([`service=${encodeURIComponent(service)}&fingerprint=ck%3Abound-fingerprint`]))
    await user.click(screen.getByRole("combobox", { name: "관측 세션 1 연결 계정" }))
    expect(screen.queryByRole("option", { name: "다른 서비스" })).not.toBeInTheDocument()
  })

  it("sends managed capture actions and confirmation-gated reset without exposing secret sentinels", async () => {
    const user = userEvent.setup()
    const { fetchStub } = renderAccounts()

    await screen.findAllByText("ACTIVE")
    await user.click(screen.getByRole("button", { name: "계정 A 세션 폐기" }))
    await waitFor(() => expect(postBodies(fetchStub, "/api/session-capture")).toEqual(["action=revoke&account=account-a"]))
    await user.click(screen.getByRole("button", { name: "세션·신원 매핑 초기화" }))
    expect(postBodies(fetchStub, "/api/identity-reset")).toEqual([])
    await user.click(await screen.findByRole("button", { name: "세션 매핑 초기화 확인" }))
    await waitFor(() => expect(postBodies(fetchStub, "/api/identity-reset")).toEqual([""]))
    expect(await screen.findByText("/api/identity-reset 완료")).toBeVisible()

    for (const secret of secretSentinels) {
      expect(document.body.textContent).not.toContain(secret)
      expect(document.title).not.toContain(secret)
      expect(renderedAttributeValues().join("\n")).not.toContain(secret)
      expect([...storedValues(localStorage), ...storedValues(sessionStorage)].join("\n")).not.toContain(secret)
    }
    for (const values of postedFormValues(fetchStub)) {
      for (const secret of secretSentinels) {
        expect(values.toString()).not.toContain(secret)
        expect([...values.entries()].flat().join("\n")).not.toContain(secret)
      }
    }
  })

  it("never renders a complete fingerprint but submits the exact fingerprint only after the explicit bind action", async () => {
    const user = userEvent.setup()
    const { fetchStub } = renderAccounts()

    await screen.findByRole("heading", { name: "계정·세션 관리" })
    await user.click(screen.getByRole("button", { name: "고급 세션 진단 열기" }))
    const fingerprint = "ck:one-way-fingerprint"
    expect(document.body.textContent).not.toContain(fingerprint)
    expect(document.title).not.toContain(fingerprint)
    expect(renderedAttributeValues().join("\n")).not.toContain(fingerprint)
    expect([...storedValues(localStorage), ...storedValues(sessionStorage)].join("\n")).not.toContain(fingerprint)
    await choose(user, "관측 세션 1 연결 계정", "계정 A")
    await user.click(screen.getByRole("button", { name: "관측 세션 1 연결" }))
    await waitFor(() => expect(postBodies(fetchStub, "/api/session-bind")).toEqual([`service=${encodeURIComponent(service)}&fingerprint=${encodeURIComponent(fingerprint)}&account=account-a`]))
  })

  it("sends create id=, refetches snapshot after success, and prevents a pending capture from double-submitting", async () => {
    const user = userEvent.setup()
    const create = renderAccounts({ snapshot: { accounts: [], sessions: [], managedSessions: [] } })
    await screen.findByRole("heading", { name: "계정·세션 관리" })
    await user.type(screen.getByLabelText("등록 계정 표시 이름"), "새 계정")
    await user.type(screen.getByLabelText("등록 계정 대상 서비스"), service)
    await user.click(screen.getByRole("button", { name: "계정 저장" }))
    await waitFor(() => expect(postBodies(create.fetchStub, "/api/account-save")).toEqual([new URLSearchParams({ id: "", label: "새 계정", role: "User", target: service }).toString()]))
    await waitFor(() => expect(snapshotReads(create.fetchStub)).toBeGreaterThan(1))

    create.unmount()
    const pending = renderAccounts({ snapshot: { accounts: [{ id: "begin-account", label: "시작 계정", role: "User", target: service, color: "", authArtifactCount: 0 }], sessions: [], managedSessions: [] }, pendingPath: "/api/session-capture" })
    await screen.findByRole("button", { name: "시작 계정 로그인 연결 시작" })
    const begin = screen.getByRole("button", { name: "시작 계정 로그인 연결 시작" })
    await user.click(begin)
    expect(begin).toBeDisabled()
    await user.click(begin)
    expect(postBodies(pending.fetchStub, "/api/session-capture")).toEqual(["action=begin&account=begin-account"])
  })

  it("uses exact begin, end, and revoke capture actions for the corresponding managed state", async () => {
    const user = userEvent.setup()
    const { fetchStub } = renderAccounts({ snapshot: {
      accounts: [
        { id: "begin-account", label: "시작 계정", role: "User", target: service, color: "", authArtifactCount: 0 },
        { id: "end-account", label: "종료 계정", role: "User", target: service, color: "", authArtifactCount: 0 },
        { id: "revoke-account", label: "폐기 계정", role: "User", target: service, color: "", authArtifactCount: 0 },
      ],
      sessions: [],
      managedSessions: [
        { handle: "capture", accountId: "end-account", accountLabel: "종료 계정", service, status: "CAPTURING", createdAt: "", lastUsedAt: null, expiresAtHint: null, hasAuthorization: false, cookieCount: 0, capturing: true, credentialConflict: false },
        { handle: "active", accountId: "revoke-account", accountLabel: "폐기 계정", service, status: "ACTIVE", createdAt: "", lastUsedAt: null, expiresAtHint: null, hasAuthorization: true, cookieCount: 1, capturing: false, credentialConflict: false },
      ],
    } })
    await screen.findByRole("button", { name: "시작 계정 로그인 연결 시작" })
    await user.click(screen.getByRole("button", { name: "시작 계정 로그인 연결 시작" }))
    await user.click(screen.getByRole("button", { name: "종료 계정 로그인 캡처 종료" }))
    await user.click(screen.getByRole("button", { name: "폐기 계정 세션 폐기" }))
    await waitFor(() => expect(postBodies(fetchStub, "/api/session-capture")).toEqual([
      "action=begin&account=begin-account",
      "action=end&account=end-account",
      "action=revoke&account=revoke-account",
    ]))
  })

  it("invalidates the snapshot after every successful account and session mutation", async () => {
    const user = userEvent.setup()
    const { fetchStub } = renderAccounts()
    const expectRefetch = async (action: () => Promise<void>) => {
      const before = snapshotReads(fetchStub)
      await action()
      await waitFor(() => expect(snapshotReads(fetchStub)).toBeGreaterThan(before))
    }

    await screen.findByRole("heading", { name: "계정·세션 관리" })
    await expectRefetch(async () => {
      await user.type(screen.getByLabelText("등록 계정 표시 이름"), "갱신 계정")
      await user.type(screen.getByLabelText("등록 계정 대상 서비스"), service)
      await user.click(screen.getByRole("button", { name: "계정 저장" }))
    })

    await expectRefetch(async () => {
      await user.click(screen.getByRole("button", { name: "관측 신원 역할 열기" }))
      await user.click(screen.getByRole("button", { name: "관측 신원 역할 저장" }))
    })
    await expectRefetch(async () => {
      await user.click(screen.getByRole("button", { name: "같은 사용자로 병합" }))
    })

    await user.click(screen.getByRole("button", { name: "고급 세션 진단 열기" }))
    await choose(user, "관측 세션 1 연결 계정", "계정 A")
    await expectRefetch(async () => {
      await user.click(screen.getByRole("button", { name: "관측 세션 1 연결" }))
    })
    await expectRefetch(async () => {
      await user.click(screen.getByRole("button", { name: "관측 세션 2 연결 해제" }))
    })
    await expectRefetch(async () => {
      await user.click(screen.getByRole("button", { name: "계정 A 세션 폐기" }))
    })

    await expectRefetch(async () => {
      await user.click(screen.getByRole("button", { name: "세션·신원 매핑 초기화" }))
      await user.click(await screen.findByRole("button", { name: "세션 매핑 초기화 확인" }))
    })
    await user.click(screen.getByRole("button", { name: "취소" }))
    await expectRefetch(async () => {
      await user.click(screen.getByRole("button", { name: "다른 서비스 삭제" }))
      await user.click(await screen.findByRole("button", { name: "계정 삭제 확인" }))
    })
  }, 15_000)

  it("keeps each server error beside its originating action without clearing an unrelated form", async () => {
    const user = userEvent.setup()
    const errors = {
      "/api/account-delete": "삭제 경쟁 오류",
      "/api/role": "역할 저장 오류",
      "/api/identity-merge": "병합 오류",
      "/api/session-bind": "연결 오류",
      "/api/session-unbind": "연결 해제 오류",
      "/api/session-capture": "캡처 오류",
      "/api/identity-reset": "초기화 오류",
    }
    renderAccounts({ postError: errors })
    await screen.findByRole("heading", { name: "계정·세션 관리" })
    await user.type(screen.getByLabelText("등록 계정 표시 이름"), "보존할 입력")

    await user.click(screen.getByRole("button", { name: "다른 서비스 삭제" }))
    await user.click(await screen.findByRole("button", { name: "계정 삭제 확인" }))
    expect(await screen.findByRole("alert", { name: errors["/api/account-delete"] })).toBeVisible()
    expect(screen.getByRole("alertdialog")).toBeVisible()
    await user.click(screen.getByRole("button", { name: "취소" }))

    await user.click(screen.getByRole("button", { name: "관측 신원 역할 열기" }))
    await user.click(screen.getByRole("button", { name: "관측 신원 역할 저장" }))
    expect(await screen.findByRole("alert", { name: errors["/api/role"] })).toBeVisible()
    await user.click(screen.getByRole("button", { name: "같은 사용자로 병합" }))
    expect(await screen.findByRole("alert", { name: errors["/api/identity-merge"] })).toBeVisible()

    await user.click(screen.getByRole("button", { name: "고급 세션 진단 열기" }))
    await choose(user, "관측 세션 1 연결 계정", "계정 A")
    await user.click(screen.getByRole("button", { name: "관측 세션 1 연결" }))
    expect(await screen.findByRole("alert", { name: errors["/api/session-bind"] })).toBeVisible()
    await user.click(screen.getByRole("button", { name: "관측 세션 2 연결 해제" }))
    expect(await screen.findByRole("alert", { name: errors["/api/session-unbind"] })).toBeVisible()
    await user.click(screen.getByRole("button", { name: "계정 A 세션 폐기" }))
    expect(await screen.findByRole("alert", { name: errors["/api/session-capture"] })).toBeVisible()

    await user.click(screen.getByRole("button", { name: "세션·신원 매핑 초기화" }))
    await user.click(await screen.findByRole("button", { name: "세션 매핑 초기화 확인" }))
    expect(await screen.findByRole("alert", { name: errors["/api/identity-reset"] })).toBeVisible()
    expect(screen.getByRole("alertdialog")).toBeVisible()
    expect(screen.getByLabelText("등록 계정 표시 이름")).toHaveValue("보존할 입력")
  }, 15_000)

  it("places actual account and session counts around the management workspace", async () => {
    renderAccounts()

    await screen.findByRole("heading", { name: "계정·세션 관리" })
    const strip = await screen.findByRole("group", { name: "계정·세션 요약" })
    expect(strip).toHaveTextContent("등록 계정")
    expect(strip).toHaveTextContent("관측 세션")
    expect(strip).toHaveTextContent("관리 세션")
    expect(screen.queryByRole("complementary", { name: "분석 필터" })).not.toBeInTheDocument()
    expect(screen.queryByRole("complementary", { name: "선택 상세" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "세션·신원 매핑 초기화" })).toBeEnabled()
  })

  it.each([900, 600])("keeps account summary, guidance, and account mutation controls reachable through compact Sheets at %ipx", async (width) => {
    setCompactViewport(width)
    const user = userEvent.setup()
    renderAccounts()

    await screen.findByRole("heading", { name: "계정·세션 관리" })
    expect(screen.queryByRole("button", { name: "분석 필터 열기" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "선택 상세 열기" })).not.toBeInTheDocument()
    expect(screen.getByRole("group", { name: "계정·세션 요약" })).toBeVisible()
    expect(screen.getByRole("button", { name: "계정 저장" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "계정 A 수정 패널" })).toBeEnabled()
  })
})
