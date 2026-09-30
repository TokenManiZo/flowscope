import { RelationshipGraphView } from "./RelationshipGraphView"

/** `#graph`: 전체 관계 보기(Site→API 그룹→API→Object 계층). */
export function GraphPage() {
  return <div className="flex h-full min-h-0 min-w-0 flex-col bg-[var(--flowscope-canvas)]"><RelationshipGraphView /></div>
}
