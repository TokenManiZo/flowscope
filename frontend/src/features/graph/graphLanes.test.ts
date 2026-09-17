import { describe, expect, it } from "vitest"

import { clampBetweenLanes, LANE_GAP, LANE_SPACING, laneAnchor, laneIndexForKind, laneLimits } from "./graphLanes"

describe("graph lanes", () => {
  it("maps node kinds to the lane of the current hierarchy level", () => {
    expect(laneIndexForKind("identity", 3)).toBe(0)
    expect(laneIndexForKind("target", 2)).toBe(0)
    expect(laneIndexForKind("operation", 3)).toBe(1)
    expect(laneIndexForKind("route-candidate", 3)).toBe(1)
    expect(laneIndexForKind("resource", 3)).toBe(2)
    expect(laneIndexForKind("api-group", 2)).toBe(1)
  })

  it("spaces the initial lane anchors evenly", () => {
    expect([0, 1, 2].map(laneAnchor)).toEqual([LANE_SPACING / 2, LANE_SPACING * 1.5, LANE_SPACING * 2.5])
  })

  it("limits a node to the nearest neighbour lane edges and leaves empty sides open", () => {
    const bounds = [{ left: 0, right: 200 }, { left: 400, right: 600 }, null]
    expect(laneLimits(bounds, 1, 100)).toEqual({ left: 200 + LANE_GAP + 50, right: Number.POSITIVE_INFINITY })
    expect(laneLimits(bounds, 0, 100)).toEqual({ left: Number.NEGATIVE_INFINITY, right: 400 - LANE_GAP - 50 })
    expect(laneLimits([null, null, null], 1, 100)).toEqual({ left: Number.NEGATIVE_INFINITY, right: Number.POSITIVE_INFINITY })
  })

  it("keeps a node between its neighbours and centers it when both sides squeeze", () => {
    expect(clampBetweenLanes(1000, { left: 100, right: 300 })).toBe(300)
    expect(clampBetweenLanes(-1000, { left: 100, right: 300 })).toBe(100)
    expect(clampBetweenLanes(200, { left: 100, right: 300 })).toBe(200)
    expect(clampBetweenLanes(9999, { left: 100, right: Number.POSITIVE_INFINITY })).toBe(9999)
    expect(clampBetweenLanes(200, { left: 400, right: 200 })).toBe(300)
    expect(clampBetweenLanes(Number.NaN, { left: 120, right: 300 })).toBe(120)
  })
})
