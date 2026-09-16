import { describe, expect, it } from "vitest"

import { clampLaneX, DEFAULT_LANE_WIDTH, defaultLaneWidths, laneBoundaries, laneGeometry, laneIndexForKind, MIN_LANE_WIDTH } from "./graphLanes"

describe("graph lanes", () => {
  it("maps node kinds to the lane of the current hierarchy level", () => {
    expect(laneIndexForKind("identity", 3)).toBe(0)
    expect(laneIndexForKind("target", 2)).toBe(0)
    expect(laneIndexForKind("operation", 3)).toBe(1)
    expect(laneIndexForKind("route-candidate", 3)).toBe(1)
    expect(laneIndexForKind("resource", 3)).toBe(2)
    expect(laneIndexForKind("api-group", 2)).toBe(1)
  })

  it("lays lane boundaries out in model coordinates so pan and zoom cannot move them", () => {
    expect(defaultLaneWidths(3)).toEqual([DEFAULT_LANE_WIDTH, DEFAULT_LANE_WIDTH, DEFAULT_LANE_WIDTH])
    expect(laneBoundaries([360, 480, 360])).toEqual([0, 360, 840, 1200])
    expect(laneGeometry([360, 480, 360], 1)).toEqual({ left: 384, right: 816, anchor: 600 })
  })

  it("clamps requested widths into the supported lane range", () => {
    expect(laneBoundaries([10, Number.NaN])).toEqual([0, MIN_LANE_WIDTH, MIN_LANE_WIDTH + DEFAULT_LANE_WIDTH])
  })

  it("keeps whole nodes inside their lane and centers nodes wider than the lane", () => {
    const lane = laneGeometry([360, 360], 0)
    expect(clampLaneX(9999, lane, 226)).toBe(360 - 24 - 113)
    expect(clampLaneX(-9999, lane, 226)).toBe(24 + 113)
    expect(clampLaneX(200, lane, 226)).toBe(200)
    expect(clampLaneX(200, lane, 900)).toBe(lane.anchor)
    expect(clampLaneX(Number.NaN, lane, 226)).toBe(lane.anchor)
  })
})
