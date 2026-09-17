import { describe, expect, it } from "vitest"

import { DEFAULT_LANE_WIDTH, defaultLaneWidths, isInsideLane, LANE_ACCENTS, LANE_SNAP_DISTANCE, laneAccentForKind, laneBoundaries, laneGeometry, laneIndexForKind, MIN_LANE_WIDTH, snapsToLane } from "./graphLanes"

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

  it("exposes one accent per lane so free-placed nodes still read as their column", () => {
    expect(LANE_ACCENTS).toHaveLength(3)
    expect(laneAccentForKind("identity")).toBe(LANE_ACCENTS[0])
    expect(laneAccentForKind("target")).toBe(LANE_ACCENTS[0])
    expect(laneAccentForKind("operation")).toBe(LANE_ACCENTS[1])
    expect(laneAccentForKind("api-group")).toBe(LANE_ACCENTS[1])
    expect(laneAccentForKind("route-candidate")).toBe(LANE_ACCENTS[1])
    expect(laneAccentForKind("resource")).toBe(LANE_ACCENTS[2])
  })

  it("snaps only near the lane center and reports nodes that fall outside the lane", () => {
    const lane = laneGeometry([360, 360], 0)
    expect(lane.anchor).toBe(180)
    expect(snapsToLane(180 + LANE_SNAP_DISTANCE, lane)).toBe(true)
    expect(snapsToLane(180 - LANE_SNAP_DISTANCE, lane)).toBe(true)
    expect(snapsToLane(180 + LANE_SNAP_DISTANCE + 1, lane)).toBe(false)
    expect(snapsToLane(Number.NaN, lane)).toBe(false)

    expect(isInsideLane(180, lane, 196)).toBe(true)
    expect(isInsideLane(180, lane, 400)).toBe(false)
    expect(isInsideLane(900, lane, 196)).toBe(false)
  })
})
