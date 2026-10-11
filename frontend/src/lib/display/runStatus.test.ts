import { expect, it } from "vitest"

import { runLabel, runStatusLabel, runStatusTone, scannerStageLabel } from "./runStatus"

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

it("names a run by its tool and start time instead of the long run ID", () => {
  const at = new Date(2026, 9, 7, 14, 32).getTime()
  expect(runLabel("zap-baseline-123", "SCANNER", at)).toBe("ZAP 실행 · 10/07 14:32")
  expect(runLabel(`zap-baseline-${at}`, "SCANNER")).toBe("ZAP 실행 · 10/07 14:32")
  expect(runLabel(`llm-explorer-${at}-ab12`, "LLM")).toBe("LLM 실행 · 10/07 14:32")
  expect(runLabel("authorization-replay-3f9a", "HUMAN", at)).toBe("자동 검증 · 10/07 14:32")
  expect(runLabel("human-3f9a", "HUMAN")).toBe("수집")
  expect(runLabel("proxy-history-scanner", "SCANNER")).toBe("스캐너 실행")
  expect(runLabel("project-import", "HUMAN")).toBe("가져오기")
  expect(runLabel("custom-run", "SCANNER")).toBe("스캐너 실행")
  expect(runLabel("custom-run")).toBe("실행")
})
