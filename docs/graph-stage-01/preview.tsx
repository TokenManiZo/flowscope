import '../../frontend/src/index.css'
import './preview.css'
import { createRoot } from 'react-dom/client'
import { useEffect, useMemo, useRef, useState } from 'react'
import cytoscape, { type Core } from 'cytoscape'
import { AlignVerticalSpaceAround, ChevronLeft, ChevronRight, Crosshair, Filter, LockKeyhole, Minus, Plus, UserRound, ScanLine, Bot } from 'lucide-react'
import { App } from '@/app/App'
import { AppProviders } from '@/app/AppProviders'
import { routeFromHash } from '@/app/routes'
import { ReferenceAppShell } from '@/components/layout/ReferenceAppShell'
import { ReferenceAnalysisWorkspace } from '@/components/layout/ReferenceAnalysisWorkspace'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { useDocumentTheme } from '@/hooks/useTheme'
import { flowScopeQueryClient } from '@/lib/query/client'
import type { Snapshot } from '@/lib/api/types'
import { projectHierarchy, navigateHierarchy, type GraphNavigation, type HierarchyProjection } from '@/features/graph/graphHierarchy'
import { graphWheelIntent } from '@/features/graph/CytoscapeGraph'
import { relationshipNodeCard } from '@/features/graph/relationshipNodeCard'
import { renderParameterNodeCardSvg } from '@/features/parameter-map/parameterNodeCard'
import sample from '@/test/sample/sample-snapshot.json'

// Review-only state. No product endpoint or database is changed by this prototype.
type Point = { x: number; y: number }
type Layout = { positions: Record<string, Point>; sizes: Record<string, { width: number; height: number }>; viewport: { zoom: number; pan: Point } | null }
type Project = { views: Record<string, Layout>; navigation: GraphNavigation; expanded: string[]; locked: boolean; extra: number }
type Book = { active: 'a' | 'b'; projects: Record<'a' | 'b', Project> }
const storeKey = 'flowscope.mock.graph-stage01'
const filters = { source: ['human', 'scanner', 'llm'], identity: [], view: 'source', includeRouteCandidates: false, includeSupportTraffic: false, expanded: false } as const
const emptyNavigation: GraphNavigation = { level: 'site', groupId: '', operation: '', operationLimit: 18, objectLimit: 18, focusCandidateKey: '' }
const ordersGroup = projectHierarchy(sample as unknown as Snapshot, filters, emptyNavigation).groups.find(group => group.key === 'orders')!
const firstNavigation = navigateHierarchy(emptyNavigation, 'group', ordersGroup.id)
const newProject = (): Project => ({ views: {}, navigation: firstNavigation, expanded: [], locked: false, extra: 0 })
function readBook(): Book { try { return JSON.parse(localStorage.getItem(storeKey)!) ?? { active: 'a', projects: { a: newProject(), b: newProject() } } } catch { return { active: 'a', projects: { a: newProject(), b: newProject() } } } }
const book = { current: readBook() }
let datasetGeneration = 100
let visibleCore: Core | null = null
const viewKey = (navigation: GraphNavigation) => JSON.stringify([navigation.level, navigation.groupId, navigation.operation])
const projectName = (id = book.current.active) => id === 'a' ? '주문 서비스 · 예시 A' : '주문 서비스 · 예시 B'
function persist() { localStorage.setItem(storeKey, JSON.stringify(book.current)) }
function dataset(): Snapshot {
  const snapshot = structuredClone(sample) as unknown as Snapshot
  const count = book.current.projects[book.current.active].extra
  snapshot.revision = datasetGeneration
  for (let index = 0; index < count; index++) {
    const op = `https://demo.flowscope.test:443 GET /api/orders/recent-${index + 1}`
    const evidenceId = `stage01-synthetic-${index + 1}`
    const event = { ...snapshot.events[0], eventId: evidenceId, op, method: 'GET', path: `/api/orders/recent-${index + 1}`, idn: 'acct-demo-user-a', resource: null, objects: [], source: 'human' as const, clusterEvidenceIds: [evidenceId], status: 200 }
    snapshot.events = [...snapshot.events, event]
    snapshot.cells = [...snapshot.cells, { idn: 'acct-demo-user-a', op, resource: null, perSource: { human: 'allow' }, reasons: {}, overall: 'allow', conflict: false, missedSources: [], evidenceIds: [evidenceId] }]
  }
  return snapshot
}

// All API responses are synthetic, local, and read-only. Mutating requests fail closed.
const originalFetch = window.fetch.bind(window)
window.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href)
  if (!url.pathname.startsWith('/api/')) return originalFetch(input, init)
  if (url.origin !== location.origin || (init?.method ?? (input instanceof Request ? input.method : 'GET')) !== 'GET') return Response.json({ success: false, message: '이 목업은 제품 데이터를 변경하지 않습니다.' }, { status: 405 })
  let value: unknown
  switch (url.pathname) {
    case '/api/snapshot': value = dataset(); break
    case '/api/projects': value = { directory: '목업 전용', active: { id: book.current.active, name: projectName(), scope: ['https://demo.flowscope.test:443/'], path: '', active: true }, projects: [], saveState: 'UNMANAGED' }; break
    case '/api/human-run': value = { active: false, completed: false, runId: '', accountId: '', proxy: '' }; break
    case '/api/zap-status': value = { connected: false, state: 'UNAVAILABLE', message: '목업 예시' }; break
    case '/api/scanner-run': value = { run: { status: 'NOT_STARTED' }, accounts: [], scope: [] }; break
    case '/api/explorer-run': value = { run: { status: 'NOT_STARTED', activities: [], unresolved: [] }, accounts: [], scope: [] }; break
    case '/api/evidence': {
      const records = dataset().events.filter(event => event.op === url.searchParams.get('operation')).map(event => ({ ...event, request: `${event.method} ${event.path} HTTP/1.1\nHost: demo.flowscope.test\n`, response: `HTTP/1.1 ${event.status}\nContent-Type: application/json\n\n{"example":true}` }))
      value = { records, total: records.length, offset: 0, limit: 200, hasMore: false }; break
    }
    default: value = { success: false, message: '이 단계 목업에 포함되지 않은 조회입니다.' }
  }
  return Response.json(value)
}

function GraphCanvas({ projection, saved, locked, onSave, onSelect, onOpen, onZoom }: { projection: HierarchyProjection; saved?: Layout; locked: boolean; onSave(layout: Layout): void; onSelect(id: string): void; onOpen(id: string): void; onZoom(zoom: number): void }) {
  const host = useRef<HTMLDivElement>(null)
  const coreRef = useRef<Core | null>(null)
  const callbacks = useRef({ onSave, onSelect, onOpen, onZoom })
  const syncing = useRef(false)
  const cards = useRef(new Map())
  const lockedRef = useRef(locked)
  callbacks.current = { onSave, onSelect, onOpen, onZoom }; lockedRef.current = locked
  const theme = useDocumentTheme()
  function capture() {
    const core = coreRef.current
    if (!core || syncing.current) return
    const positions: Layout['positions'] = {}, sizes: Layout['sizes'] = {}
    core.nodes().forEach(node => { positions[node.id()] = { ...node.position() }; if (node.data('customSize')) sizes[node.id()] = node.data('customSize') })
    callbacks.current.onSave({ positions, sizes, viewport: { zoom: core.zoom(), pan: { ...core.pan() } } })
    callbacks.current.onZoom(core.zoom())
  }
  function positionNewNodes(core: Core) {
    const bottom = [84, 84, 84]
    core.nodes().filter(node => !node.data('newNode')).forEach(node => { const lane = node.data('lane'); bottom[lane] = Math.max(bottom[lane], node.position().y + Number(node.data('height')) / 2 + 24) })
    core.nodes().filter(node => node.data('newNode')).forEach(node => { const lane = node.data('lane'), height = Number(node.data('height')); node.position({ x: 220 + lane * 350, y: bottom[lane] + height / 2 }); bottom[lane] += height + 24; node.removeData('newNode') })
  }
  useEffect(() => {
    const core = cytoscape({ container: host.current, elements: [], userZoomingEnabled: false, boxSelectionEnabled: false, minZoom: 0.4, maxZoom: 2,
      style: [
        { selector: 'node', style: { width: 'data(width)', height: 'data(height)', shape: 'round-rectangle', padding: 0, 'background-color': 'data(surface)', 'background-image': 'data(image)', 'background-fit': 'contain', 'border-width': 1, 'border-color': '#64748b' } },
        { selector: 'node:selected', style: { 'border-width': 2, 'border-color': '#60a5fa', 'overlay-opacity': 0 } },
        { selector: 'edge', style: { width: 1.2, 'line-color': '#94a3b8', 'target-arrow-color': '#94a3b8', 'target-arrow-shape': 'triangle', 'curve-style': 'taxi', 'taxi-direction': 'rightward', 'taxi-turn': '50%' } },
      ],
    })
    coreRef.current = core; visibleCore = core
    core.on('dragfree viewport', capture)
    core.on('tap', 'node', event => callbacks.current.onSelect(event.target.id()))
    core.on('dbltap', 'node', event => callbacks.current.onOpen(event.target.id()))
    core.on('tap', event => { if (event.target === core) callbacks.current.onSelect('') })
    const command = (event: Event) => {
      const { action, delta } = (event as CustomEvent).detail
      if (action === 'fit') core.fit(core.elements(), 54)
      if (action === 'zoom') core.zoom(Math.max(0.4, Math.min(2, core.zoom() + delta)))
      if (action === 'sort') { syncing.current = true; core.nodes().forEach(node => { node.unlock(); node.data('newNode', true) }); positionNewNodes(core); if (lockedRef.current) core.nodes().lock(); syncing.current = false }
      capture()
    }
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      if (graphWheelIntent('auto', event) === 'pan') core.panBy({ x: -event.deltaX, y: -event.deltaY })
      else { const box = host.current!.getBoundingClientRect(); core.zoom({ level: Math.max(0.4, Math.min(2, core.zoom() * Math.exp(-event.deltaY * 0.002))), renderedPosition: { x: event.clientX - box.left, y: event.clientY - box.top } }) }
    }
    let resize: { node: cytoscape.NodeSingular; x: number; y: number; width: number; height: number; left: number; top: number } | null = null
    const corner = (event: PointerEvent) => {
      if (lockedRef.current) return null
      const box = host.current!.getBoundingClientRect(), x = event.clientX - box.left, y = event.clientY - box.top
      return core.nodes().toArray().find(node => { const bounds = node.renderedBoundingBox(); return Math.abs(x - bounds.x2) <= 12 && Math.abs(y - bounds.y2) <= 12 })
    }
    const down = (event: PointerEvent) => {
      const node = corner(event); if (!node) return
      event.preventDefault(); event.stopImmediatePropagation(); host.current!.setPointerCapture(event.pointerId); core.userPanningEnabled(false)
      resize = { node, x: event.clientX, y: event.clientY, width: node.width(), height: node.height(), left: node.position().x - node.width() / 2, top: node.position().y - node.height() / 2 }
    }
    const move = (event: PointerEvent) => {
      if (!resize) { host.current!.style.cursor = corner(event) ? 'nwse-resize' : ''; return }
      const { node } = resize, card = cards.current.get(node.id())
      const size = { width: Math.round(Math.max(226, Math.min(480, resize.width + (event.clientX - resize.x) / core.zoom()))), height: Math.round(Math.max(64, Math.min(320, resize.height + (event.clientY - resize.y) / core.zoom()))) }
      const image = renderParameterNodeCardSvg(card, true, size, document.documentElement.classList.contains('dark') ? 'dark' : 'light')
      node.data({ width: image.width, height: image.height, image: image.uri, customSize: size }); node.position({ x: resize.left + image.width / 2, y: resize.top + image.height / 2 })
    }
    const up = () => { if (resize) { resize = null; core.userPanningEnabled(true); capture() } }
    const observer = new ResizeObserver(() => core.resize()); observer.observe(host.current!)
    window.addEventListener('stage01-command', command)
    host.current!.addEventListener('wheel', wheel, { passive: false })
    host.current!.addEventListener('pointerdown', down, true); host.current!.addEventListener('pointermove', move, true); host.current!.addEventListener('pointerup', up, true); host.current!.addEventListener('pointercancel', up, true)
    return () => { observer.disconnect(); window.removeEventListener('stage01-command', command); host.current?.removeEventListener('wheel', wheel); host.current?.removeEventListener('pointerdown', down, true); host.current?.removeEventListener('pointermove', move, true); host.current?.removeEventListener('pointerup', up, true); host.current?.removeEventListener('pointercancel', up, true); core.destroy(); coreRef.current = null; if (visibleCore === core) visibleCore = null }
  }, [])
  useEffect(() => {
    const core = coreRef.current!; syncing.current = true; core.batch(() => {
      const visible = projection.nodes.filter(node => !node.hiddenInGraph)
      const ids = new Set(visible.map(node => node.id))
      core.edges().remove(); core.nodes().filter(node => !ids.has(node.id())).remove(); cards.current.clear()
      for (const node of visible) {
        const statuses = node.kind === 'operation' ? [...new Set(dataset().events.filter(event => event.op === node.selection.operation).map(event => event.status))] : []
        const base = relationshipNodeCard(node, projection, statuses)
        const sources = [...new Set(projection.edges.filter(edge => edge.sourceId === node.id || edge.targetId === node.id).map(edge => edge.source).filter(source => source === 'human' || source === 'scanner' || source === 'llm'))]
        const card = node.kind === 'operation' || node.kind === 'resource' ? { ...base, sources } : base; cards.current.set(node.id, card)
        const image = renderParameterNodeCardSvg(card, true, saved?.sizes[node.id], theme)
        const lane = node.kind === 'identity' || node.kind === 'target' ? 0 : node.kind === 'resource' || node.kind === 'object-group' ? 2 : 1
        const data = { id: node.id, kind: node.kind, lane, width: image.width, height: image.height, image: image.uri, surface: theme === 'dark' ? '#0d1118' : '#ffffff', ...(saved?.sizes[node.id] ? { customSize: saved.sizes[node.id] } : {}) }
        const existing = core.getElementById(node.id)
        if (existing.empty()) core.add({ data: { ...data, newNode: !saved?.positions[node.id] }, position: saved?.positions[node.id] })
        else existing.data(data)
      }
      positionNewNodes(core)
      for (const edge of projection.edges) if (ids.has(edge.sourceId) && ids.has(edge.targetId)) core.add({ data: { id: edge.id, source: edge.sourceId, target: edge.targetId } })
      if (locked) core.nodes().lock(); else core.nodes().unlock()
    })
    if (saved?.viewport) core.viewport(saved.viewport); else core.fit(core.elements(), 54)
    syncing.current = false; capture()
  }, [projection, theme])
  useEffect(() => { if (locked) coreRef.current?.nodes().lock(); else coreRef.current?.nodes().unlock() }, [locked])
  return <div className="stage-canvas-shell"><div ref={host} className="stage-canvas" tabIndex={0} aria-label="1단계 배치 유지 목업 그래프" /><div className="stage-lanes" style={{ gridTemplateColumns: `repeat(${projection.kind === 'site' ? 2 : 3}, 1fr)` }}>{(projection.kind === 'site' ? ['Target', 'API Groups'] : ['Identity', 'API', 'Object']).map(label => <span key={label}>{label}</span>)}</div><div className="stage-legend"><span><UserRound size={13} />HUMAN</span><span><ScanLine size={13} />SCANNER</span><span><Bot size={13} />LLM</span></div></div>
}

const command = (action: string, delta = 0) => window.dispatchEvent(new CustomEvent('stage01-command', { detail: { action, delta } }))
function Proposed({ revision }: { revision: number }) {
  const [route, setRoute] = useState(() => routeFromHash(location.hash))
  const [, setTick] = useState(0), [selected, setSelected] = useState(''), [list, setList] = useState(false), [zoom, setZoom] = useState(1), [filterOpen, setFilterOpen] = useState(false), [inspectorOpen, setInspectorOpen] = useState(true)
  const projectId = book.current.active, project = book.current.projects[projectId], navigation = project.navigation, key = viewKey(navigation)
  const snapshot = useMemo(dataset, [revision])
  const projection = useMemo(() => projectHierarchy(snapshot, { ...filters, expandedObjectGroups: project.expanded }, navigation), [snapshot, navigation, project.expanded])
  const node = projection.nodes.find(item => item.id === selected)
  useEffect(() => { const change = () => { setRoute(routeFromHash(location.hash)); setSelected('') }; window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change) }, [])
  const navigate = (next: GraphNavigation) => { project.navigation = next; persist(); setSelected(''); setTick(value => value + 1) }
  const openNode = (id: string) => {
    const target = projection.nodes.find(item => item.id === id); if (!target) return
    if (target.kind === 'api-group') navigate(navigateHierarchy(navigation, 'group', target.groupId))
    else if (target.kind === 'operation' && navigation.level === 'group') navigate(navigateHierarchy(navigation, 'operation', navigation.groupId, target.selection.operation!))
    else if (target.kind === 'object-group' || target.kind === 'operation-group') { project.expanded = project.expanded.includes(id) ? project.expanded.filter(value => value !== id) : [...project.expanded, id]; persist(); setTick(value => value + 1) }
    else if (target.kind === 'identity') navigate(navigateHierarchy(navigation, 'group', navigation.groupId))
  }
  const save = (layout: Layout) => { const before = project.views[key]; project.views[key] = { ...layout, positions: { ...before?.positions, ...layout.positions }, sizes: { ...before?.sizes, ...layout.sizes } }; persist() }
  const filterRail = <div className="stage-panel"><h2>Graph filters</h2><h3>출처</h3>{['HUMAN', 'SCANNER', 'LLM'].map(source => <label key={source}><Checkbox defaultChecked disabled /><span>{source}</span></label>)}<h3>신원</h3>{['ADMIN', 'USER A', 'USER B'].map(identity => <label key={identity}><Checkbox disabled /><span>{identity}</span></label>)}<h3>그래프 조작</h3><div className="panel-actions"><Button variant="ghost" className="justify-start" onClick={() => command('sort')}><AlignVerticalSpaceAround size={14} />레인 기준 정렬</Button><Button variant={project.locked ? 'secondary' : 'ghost'} className="justify-start" onClick={() => { project.locked = !project.locked; persist(); setTick(value => value + 1) }}><LockKeyhole size={14} />{project.locked ? '위치 잠금 해제' : '위치 잠금'}</Button></div></div>
  const inspector = <div className="stage-panel"><h2>{node ? '선택 상세' : '현재 보기'}</h2><p className="break-path">{node?.label ?? (projection.kind === 'site' ? 'Site Overview' : projection.kind === 'group' ? 'ORDERS APIs' : navigation.operation)}</p>{node && <><h3>관측 기록</h3><p>{node.selection.evidenceIds.length}건 · 기존 Evidence 연결 유지</p></>}<h3>프로젝트 배치</h3><dl><div><dt>프로젝트</dt><dd>예시 {projectId.toUpperCase()}</dd></div><div><dt>보관된 보기</dt><dd>{Object.keys(project.views).length}개</dd></div><div><dt>현재 위치</dt><dd>{project.locked ? '잠금' : '이동 가능'}</dd></div></dl><h3>배치 조작</h3><p>노드를 드래그해 이동합니다. 오른쪽 아래 모서리를 끌면 크기를 바꿀 수 있습니다.</p><p className="mt-3 text-muted-foreground">화면에 맞추기는 확대율과 화면 위치만 조절합니다. 정렬할 때도 카드 크기는 유지합니다.</p></div>
  const toolbar = <div className="stage-toolbar"><Button variant="outline" size="icon" aria-label="상위 계층으로" disabled={navigation.level === 'site'} onClick={() => navigate(navigateHierarchy(navigation, navigation.level === 'operation' ? 'group' : 'site', navigation.groupId))}><ChevronLeft size={18} /></Button><Button variant={list ? 'ghost' : 'secondary'} onClick={() => setList(false)}>그래프</Button><Button variant={list ? 'secondary' : 'ghost'} onClick={() => setList(true)}>목록</Button><div className="toolbar-end"><Button variant="outline" aria-label="그래프 필터" className="xl:hidden" onClick={() => setFilterOpen(true)}><Filter size={14} />필터</Button><Button variant="ghost" size="icon" aria-label="축소" disabled={zoom <= 0.4} onClick={() => command('zoom', -0.1)}><Minus size={15} /></Button><span className="zoom-label">{Math.round(zoom * 100)}%</span><Button variant="ghost" size="icon" aria-label="확대" disabled={zoom >= 2} onClick={() => command('zoom', 0.1)}><Plus size={15} /></Button><Button variant="outline" onClick={() => command('fit')}><Crosshair size={14} />화면에 맞추기</Button><Button variant="outline" onClick={() => command('sort')}><AlignVerticalSpaceAround size={14} />레인 기준 정렬</Button></div></div>
  return <ReferenceAppShell route={route}>{route === 'graph' ? <ReferenceAnalysisWorkspace ariaLabel="1단계 그래프 작업면" context={filterRail} contextTitle={false} toolbar={toolbar} contextOpen={filterOpen} onContextOpenChange={setFilterOpen} inspector={inspector} inspectorOpen={inspectorOpen} inspectorPersistent onInspectorOpenChange={setInspectorOpen}>
    <nav className="stage-breadcrumb" aria-label="그래프 계층"><Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => navigate(emptyNavigation)}>Site Overview</Button>{navigation.level !== 'site' && <><ChevronRight size={12} /><Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => navigate(navigateHierarchy(navigation, 'group', ordersGroup.id))}>ORDERS APIs</Button></>}{navigation.level === 'operation' && <><ChevronRight size={12} /><span>{navigation.operation.replace(/^https?:\/\/\S+\s+/, '')}</span></>}</nav>
    {list ? <div className="stage-list">{projection.nodes.filter(item => !item.hiddenInGraph).map(item => <button key={item.id} onClick={() => { setList(false); openNode(item.id) }}>{item.label}</button>)}</div> : <GraphCanvas key={`${projectId}:${key}`} projection={projection} saved={project.views[key]} locked={project.locked} onSave={save} onSelect={setSelected} onOpen={openNode} onZoom={setZoom} />}
  </ReferenceAnalysisWorkspace> : <div className="other-screen"><h2>{route === 'accounts' ? '계정·세션' : route === 'inspection' ? '점검 시작' : '다른 화면'}</h2><p>화면 이동을 확인하기 위한 예시입니다. 왼쪽 그래프 메뉴로 돌아가 배치를 확인하세요.</p><table><thead><tr><th>등록 계정</th><th>역할</th><th>대상</th></tr></thead><tbody>{sample.accounts.map(account => <tr key={account.id}><td>{account.label}</td><td>{account.role}</td><td>{account.target}</td></tr>)}</tbody></table><Button variant="outline" className="mt-5" onClick={() => { location.hash = '#graph' }}>그래프로 돌아가기</Button></div>}</ReferenceAppShell>
}

function Review() {
  const mode = new URLSearchParams(location.search).get('mode') ?? 'proposed'
  const [revision, setRevision] = useState(0), [remount, setRemount] = useState(0)
  const [notice, setNotice] = useState('노드를 이동하거나 크기를 바꾼 뒤 계정·세션 화면을 다녀오세요. 계층은 더블클릭으로 이동합니다.')
  const update = () => { datasetGeneration++; setRevision(value => value + 1); void flowScopeQueryClient.invalidateQueries() }
  const switchProject = (id: 'a' | 'b') => { book.current.active = id; persist(); update(); setRemount(value => value + 1); setNotice(`예시 ${id.toUpperCase()} 프로젝트의 배치를 열었습니다.`) }
  useEffect(() => {
    (window as any).stage01 = { inspect: () => ({ mode, project: book.current.active, state: structuredClone(book.current), nodes: visibleCore?.nodes().map(node => ({ id: node.id(), position: node.position(), center: node.renderedPosition(), bounds: node.renderedBoundingBox(), width: node.width(), height: node.height() })), viewport: visibleCore ? { zoom: visibleCore.zoom(), pan: visibleCore.pan() } : null }) }
    return () => { delete (window as any).stage01 }
  }, [])
  return <div className="review-shell"><header className="review-header"><div className="review-heading"><h1>1단계 · 배치 유지와 프로젝트 저장</h1><Button size="sm" variant={mode === 'proposed' ? 'secondary' : 'outline'} asChild><a href="?mode=proposed#graph">목업 보기</a></Button><Button size="sm" variant={mode === 'baseline' ? 'secondary' : 'outline'} asChild><a href="?mode=baseline&flowscope-e2e-geometry=1#graph">현행 QA_TEMP</a></Button></div><p className="review-copy">QA_TEMP 8bc618f · 합성 샘플 · 목업 저장은 이 브라우저에서만 시뮬레이션합니다. 승인 후 제품의 프로젝트 DB·JSON 저장에 연결합니다.</p>{mode === 'proposed' ? <div className="review-tools"><label className="text-xs" htmlFor="review-project">프로젝트</label><select id="review-project" aria-label="목업 프로젝트" value={book.current.active} onChange={event => switchProject(event.target.value as 'a' | 'b')}><option value="a">예시 A · 주문 서비스</option><option value="b">예시 B · 별도 배치</option></select><Button size="sm" variant="outline" onClick={() => { book.current = readBook(); setRemount(value => value + 1); setNotice('저장된 배치를 다시 열었습니다. 위치·크기·확대율이 유지됩니다.') }}>프로젝트 다시 열기</Button><Button size="sm" variant="outline" onClick={() => { book.current.projects[book.current.active].extra++; persist(); update(); setNotice('합성 신규 노드 1개를 추가했습니다. 기존 노드 위치는 유지합니다.') }}>신규 노드 추가</Button><Button size="sm" variant="ghost" onClick={() => { book.current.projects[book.current.active] = newProject(); persist(); update(); setRemount(value => value + 1); location.hash = '#graph'; setNotice('목업 예시 배치를 초기 상태로 되돌렸습니다.') }}>예시 초기화</Button></div> : null}<p className="review-copy" role="status">{mode === 'baseline' ? '수정하지 않은 QA_TEMP 화면입니다. 같은 레인 노드를 겹치게 이동한 뒤 다른 화면을 다녀오면 위치 변화를 비교할 수 있습니다.' : notice}</p></header><div className="stage-frame"><AppProviders>{mode === 'baseline' ? <App /> : <Proposed key={`${book.current.active}:${remount}`} revision={revision} />}</AppProviders></div></div>
}

if (!location.hash) location.hash = '#graph'
createRoot(document.getElementById('root')!).render(<Review />)
