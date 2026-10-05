import {it,expect} from 'vitest'
import {targetSnapshot} from '@/test/fixtures'
import type {Cell} from '@/lib/api/types'
import {projectHierarchy} from './graphHierarchy'
const service='https://demo.test:443', groupId=JSON.stringify([service,'orders'])
const filters={source:['human' as const,'scanner' as const,'llm' as const],identity:[],view:'source' as const,includeRouteCandidates:false,includeSupportTraffic:false,expanded:false}
const nav={level:'group' as const,groupId,operation:'',operationLimit:18,objectLimit:18,focusCandidateKey:''}
const cell=(changes:Partial<Cell>={}):Cell=>({idn:'A',op:`${service} GET /api/orders/human`,resource:null,perSource:{human:'suspicious'},reasons:{},overall:'suspicious',conflict:false,missedSources:[],evidenceIds:['human'],...changes})
it('other-source allow cannot fold a HUMAN suspicious API',()=>{
 const data=targetSnapshot({cells:[cell({perSource:{human:'suspicious',scanner:'allow',llm:'allow'},conflict:true})]})
 const graph=projectHierarchy(data,filters,nav)
 expect(graph.nodes.some(n=>n.kind==='operation'&&!n.hiddenInGraph)).toBe(true)
 expect(graph.nodes.find(n=>n.kind==='quiet-group')).toBeUndefined()
})
it('HUMAN signal retains a first-page place among scanner-only signals',()=>{
 const scanners=Array.from({length:18},(_,i)=>cell({op:`${service} GET /api/orders/scanner-${i}`,perSource:{scanner:'suspicious'},evidenceIds:[`s${i}-1`,`s${i}-2`]}))
 const graph=projectHierarchy(targetSnapshot({cells:[cell(),...scanners]}),filters,nav)
 expect(graph.nodes.some(n=>n.selection.operation===cell().op&&!n.hiddenInGraph)).toBe(true)
})

it('prioritizes HUMAN observed writes without creating authorization cells', () => {
  const event = (index: number, source: 'human' | 'scanner') => ({ eventId: `e-${index}`, method: 'POST', path: `/api/orders/write-${index}`, status: 200, fp: '', idn: 'A', role: 'USER', source, op: `${service} POST /api/orders/write-${index}`, resource: null, timestamp: 1, sourceDetail: 'browser', orchestrator: 'HUMAN', tool: 'browser', phase: 'DISCOVERY', executionTrust: 'OBSERVED', runId: 'r', authState: 'AUTH', trafficClass: 'UNKNOWN', trafficDisposition: 'REVIEW', coverageEligible: false, classificationOverride: false, classificationReasons: [], pathTemplateStatus: 'LITERAL', pathTemplateReasons: [], clusterId: 'c', repeatCount: 1, firstSeen: 1, lastSeen: 1, clusterEvidenceIds: [`e-${index}`], objects: [], verdict: 'untested' as const })
  const human = event(18, 'human')
  const snapshot = targetSnapshot({ events: [...Array.from({ length: 18 }, (_, index) => event(index, 'scanner')), human] })
  const before = JSON.stringify(snapshot)
  const graph = projectHierarchy(snapshot, { ...filters, includeSupportTraffic: true }, nav)
  expect(graph.nodes.find(node => node.kind === 'observed-operation')?.selection.operation).toBe(human.op)
  expect(graph.nodes.find(node => node.selection.operation === human.op)?.selection.cells).toEqual([])
  expect(JSON.stringify(snapshot)).toBe(before)
})
