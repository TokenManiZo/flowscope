import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it, vi } from "vitest"
import type { SurfaceParameter } from "@/lib/api/types"
import { hasInputDifference, parameterComparison, SurfaceParameterComparison } from "./SurfaceParameterComparison"
const parameter: SurfaceParameter = {location:"JSON_BODY",fieldPath:"/notifications",displayName:"notifications",requirement:"OPTIONAL",observedShapes:["BOOLEAN","STRING"],observedSources:["HUMAN","SCANNER"],observationEvidenceIds:["h","s"],observations:[{evidenceId:"h",source:"HUMAN",runId:"h",identity:"user",status:200,valueType:"BOOLEAN"},{evidenceId:"s",source:"SCANNER",runId:"s",identity:"user",status:400,valueType:"STRING"}],declarations:[{evidenceId:"d",source:"LLM",runId:"d",type:"OPENAPI",adapter:"openapi",reason:"declaration",declaredType:"boolean"}],deltaState:"MULTI_SOURCE_OBSERVED",canonicalPath:"/notifications",observedValueTypes:["BOOLEAN","STRING"],distinctValueCount:2,coordinateResolved:true,distinctValueTruncated:false}
it("compares types from evidence without conflating boolean/string or using HTTP status as proof", () => {
  expect(parameterComparison(parameter)).toBe("형식 차이")
  expect(hasInputDifference([parameter])).toBe(true)
  expect(parameterComparison({...parameter,observations:[{...parameter.observations[0],status:500}]})).toBe("형식 일치")
  expect(parameterComparison({...parameter,observations:parameter.observations.map(item=>({...item,valueType:undefined}))})).toBe("형식 근거 부족")
  expect(parameterComparison({...parameter,coordinateResolved:false})).toBe("좌표 미확정")
  expect(hasInputDifference([{...parameter,coordinateResolved:false}])).toBe(false)
  expect(parameterComparison({...parameter,observations:[],observedSources:[]})).toBe("선언만")
  expect(parameterComparison({...parameter,declarations:[]})).toBe("관측만")
})

it("opens the exact evidence from the entire observation row and supports keyboard activation", async () => {
  const onEvidence = vi.fn()
  render(<SurfaceParameterComparison parameters={[parameter]} ordinal={id => id === "h" ? "#4" : "#9"} onEvidence={onEvidence} disabled={false} />)
  const user = userEvent.setup()
  await user.click(screen.getByText("/notifications").closest("summary")!)
  const first = screen.getByRole("button", { name: "입력 근거 기록 #4 보기" })
  await user.click(first.querySelector(".font-mono")!)
  expect(onEvidence).toHaveBeenLastCalledWith("h")
  const second = screen.getByRole("button", { name: "입력 근거 기록 #9 보기" })
  second.focus()
  await user.keyboard("{Enter}")
  expect(onEvidence).toHaveBeenLastCalledWith("s")
})
