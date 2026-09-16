import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ParameterMapPage } from "@/features/parameter-map/ParameterMapPage"
import { RelationshipGraphView } from "./RelationshipGraphView"

/** `#graph`: 전체 관계 보기(Site→API 그룹→API→Object 계층)가 기본이며 점검 우선순위는 필요할 때 연다. */
export function GraphPage() {
  const viewSwitcher = <TabsList aria-label="그래프 보기" variant="line" className="h-9 shrink-0">
      <TabsTrigger value="priority" className="px-3">점검 우선순위</TabsTrigger>
      <TabsTrigger value="relationships" className="px-3">전체 관계 보기</TabsTrigger>
    </TabsList>
  return <Tabs defaultValue="relationships" className="h-full min-h-0 min-w-0 gap-0 bg-[var(--flowscope-canvas)]">
    <TabsContent value="priority" className="min-h-0 min-w-0 flex-1"><ParameterMapPage viewSwitcher={viewSwitcher} /></TabsContent>
    <TabsContent value="relationships" className="min-h-0 min-w-0 flex-1"><RelationshipGraphView viewSwitcher={viewSwitcher} /></TabsContent>
  </Tabs>
}
