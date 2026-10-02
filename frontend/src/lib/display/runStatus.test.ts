import { expect, it } from "vitest"

import { runStatusLabel, runStatusTone, scannerStageLabel } from "./runStatus"

it("shows server run states in plain words and keeps unknown states visible", () => {
  expect(runStatusLabel("NOT_STARTED")).toBe("대기")
  expect(runStatusLabel("UNAVAILABLE")).toBe("연결 안 됨")
  expect(runStatusLabel("COMPLETED_WITH_LIMITATIONS")).toBe("완료 (제한 있음)")
  expect(runStatusLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW")
  expect(runStatusTone("FAILED")).toBe("fail")
  expect(runStatusTone("CANCELLED")).toBe("idle")
  expect(runStatusTone("RUNNING")).toBe("active")
  expect(scannerStageLabel(undefined)).toBe("대기")
  expect(scannerStageLabel("CLIENT_SPIDER")).toBe("Client Spider")
  expect(scannerStageLabel("SPIDER")).toBe("일반 Spider")
  expect(scannerStageLabel("PASSIVE_SCAN_QUEUE")).toBe("Passive Scan 대기")
  expect(scannerStageLabel("INITIALIZING")).toBe("준비 중")
  expect(scannerStageLabel("SESSION_READY")).toBe("로그인 세션 준비 완료")
})
