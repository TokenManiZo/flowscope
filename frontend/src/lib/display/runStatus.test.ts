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
})
