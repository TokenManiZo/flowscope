import { describe, expect, it } from "vitest"

import { clampRenderedPosition, graphLaneForKind, laneGeometry } from "./graphLanes"

describe("graph lanes", () => {
  it("maps graph node kinds to their fixed semantic lane", () => {
    expect(graphLaneForKind("identity")).toBe("identity")
    expect(graphLaneForKind("operation")).toBe("endpoint")
    expect(graphLaneForKind("resource")).toBe("object")
    expect(graphLaneForKind("route-candidate")).toBe("endpoint")
  })

  it("divides a 1200px canvas into IDENTITY, ENDPOINT, and OBJECT thirds", () => {
    expect(laneGeometry(1200, "identity", 24)).toEqual({ left: 24, right: 376, anchor: 200 })
    expect(laneGeometry(1200, "endpoint", 24)).toEqual({ left: 424, right: 776, anchor: 600 })
    expect(laneGeometry(1200, "object", 24)).toEqual({ left: 824, right: 1176, anchor: 1000 })
  })

  it("clamps rendered X within a lane without changing Y", () => {
    expect(clampRenderedPosition({ x: 700, y: 120 }, laneGeometry(900, "identity", 24))).toEqual({ x: 276, y: 120 })
    expect(clampRenderedPosition({ x: -20, y: 88 }, laneGeometry(900, "endpoint", 24))).toEqual({ x: 324, y: 88 })
  })
})
