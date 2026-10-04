// 승인 전 독립 목업. 네트워크·브라우저 저장·제품 API를 사용하지 않는다.
const $ = id => document.getElementById(id)
const escapeText = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const byteLength = text => new TextEncoder().encode(text).length
const sampleResponse = (id, expanded = false) => `HTTP/1.1 200 OK\nContent-Type: application/json; charset=utf-8\nCache-Control: no-store\n\n${JSON.stringify({ orderId: id, status: 'confirmed', amount: 23900, currency: 'KRW', ...(expanded ? { items: [{ name: 'Notebook', quantity: 2 }, { name: 'Pen', quantity: 1 }] } : {}) })}`
let requestTabs = new Map(), activeRequestId = 0, requestSequence = 0
let edited = false
let draft = '', draftMode = 'ACCOUNT', original = null, lastResult = null, selectedId = 0, sending = false, timer = null
let focus = 'both', split = 50, views = { request: 'raw', response: 'raw' }, draftPosition = { start: 0, end: 0, top: 0, left: 0 }
function highlight(raw) {
  let inBody = false
  return raw.split('\n').map((line, index) => {
    if (!line.trim()) inBody = true
    if (index === 0) return escapeText(line).replace(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|HTTP\/1\.1)(\s)/, '<span class="method">$1</span>$2')
    if (!inBody && line.includes(':')) { const colon = line.indexOf(':'); return `<span class="key">${escapeText(line.slice(0, colon))}</span>${escapeText(line.slice(colon))}` }
    if (inBody) return escapeText(line).replace(/(&quot;[^\n]*?&quot;)(?=\s*:)/g, '<span class="key">$1</span>').replace(/:\s*(&quot;[^\n]*?&quot;)/g, ': <span class="value">$1</span>')
    return escapeText(line)
  }).join('\n')
}
function highlightJson(text) {
  const tokens = /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b/g
  let html = '', end = 0
  for (const token of text.matchAll(tokens)) {
    const start = token.index, value = token[0]
    html += escapeText(text.slice(end, start))
    const kind = value.startsWith('"') ? /^\s*:/.test(text.slice(start + value.length)) ? 'key' : 'value' : 'number'
    html += `<span class="${kind}">${escapeText(value)}</span>`
    end = start + value.length
  }
  return html + escapeText(text.slice(end))
}
function seed() {
  clearTimeout(timer); timer = null; sending = false; selectedId = 0
  requestTabs.clear(); activeRequestId = 0; requestSequence = 0
  const originalBody = JSON.stringify({ orderId: 101, items: [{ sku: 'NOTE-01', quantity: 2 }, { sku: 'PEN-02', quantity: 1 }], note: '합성 예시' }, null, 2)
  draft = `POST /api/orders/preview HTTP/1.1\nHost: api.example.test\nAuthorization: Bearer ***MASKED***\nContent-Type: application/json; charset=utf-8\nContent-Length: ${byteLength(originalBody)}\nAccept: application/json\n\n${originalBody}`
  draftMode = 'ACCOUNT'; edited = false
  original = { id: 0, observed: true, request: draft, credential: 'ORIGINAL', response: sampleResponse(101, true), status: 200, duration: 126 }
  lastResult = original
  views = { request: 'raw', response: 'raw' }; draftPosition = { start: 0, end: 0, top: 0, left: 0 }
  $('notice').hidden = true; $('stage').hidden = false; $('closed').hidden = true; render()
}
function toast(text) { $('notice').textContent = text; $('notice').hidden = !text }
function chosenResult() { return selectedId === 0 ? original : lastResult }
function saveDraftPosition() {
  if (selectedId !== null) return
  const input = $('request'); draftPosition = { start: input.selectionStart, end: input.selectionEnd, top: input.scrollTop, left: input.scrollLeft }
}
function renderRequest() {
  const item = chosenResult(), value = selectedId === null ? draft : item?.request ?? ''
  const input = $('request'); if (input.value !== value) input.value = value
  input.readOnly = selectedId !== null; input.disabled = sending
  $('request-highlight').innerHTML = highlight(value)
  showView('request', value)
  $('request-state').textContent = selectedId === 0 ? '읽기 전용' : '편집 가능'
}
function renderResponse() {
  const item = chosenResult(), response = item?.response ?? '', empty = $('response-empty')
  $('response-raw').innerHTML = highlight(response)
  $('http-status').textContent = item?.status ? `HTTP ${item.status}` : ''
  $('http-status').classList.toggle('error', Boolean(item?.status && item.status >= 400))
  $('response-meta').title = ''
  empty.hidden = Boolean(response)
  if (!response) {
    empty.innerHTML = sending ? '<strong>응답을 기다리는 중입니다.</strong><span>요청은 한 번만 전송됩니다.</span>' : item ? `<strong>${escapeText(item.error || '응답이 없습니다.')}</strong><span>대상 처리 여부 미확인 · 직접 확인 후 다시 전송하세요.</span>` : '<strong>응답이 여기에 표시됩니다.</strong><span>요청을 수정한 뒤 전송해 보세요.</span>'
  }
  showView('response', response)
  if (!response) { $('response-raw').hidden = true; $('response-json').hidden = true }
}
function showView(pane, value) {
  const raw = $(pane === 'request' ? 'request-editor' : 'response-raw'), formatted = $(`${pane}-json`)
  const body = value.split(/\r?\n\r?\n/).slice(1).join('\n\n')
  let json = null
  try { json = JSON.stringify(JSON.parse(body), null, 2) } catch {}
  const jsonButton = document.querySelector(`[data-pane="${pane}"][data-view="json"]`)
  jsonButton.disabled = json === null
  jsonButton.title = json === null ? 'JSON 본문 없음' : ''
  if (json === null) views[pane] = 'raw'
  raw.hidden = views[pane] === 'json'; formatted.hidden = views[pane] !== 'json'
  if (views[pane] === 'json') formatted.innerHTML = highlightJson(json)
  else formatted.textContent = ''
  document.querySelectorAll(`[data-pane="${pane}"]`).forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === views[pane])))
}
function renderRequests() {
  const picker = $('request-select')
  picker.hidden = requestTabs.size === 0
  picker.innerHTML = '<option value="" disabled>요청 선택</option>' + [...requestTabs.keys()].map(id => `<option value="${id}">요청 ${id}</option>`).join('')
  picker.value = selectedId === 0 ? '' : String(activeRequestId)
  picker.classList.toggle('selected', selectedId !== 0)
  picker.disabled = sending
  $('remove-request').hidden = requestTabs.size === 0
  $('remove-request').disabled = sending || selectedId === 0
  $('remove-request').setAttribute('aria-label', selectedId === 0 ? '선택 요청 삭제' : `요청 ${activeRequestId} 삭제`)
}
function saveWorkspace() {
  if (!activeRequestId) return
  requestTabs.set(activeRequestId, { draft, draftMode, edited, lastResult, draftPosition })
}
function selectRequest(id) {
  if (sending) return
  saveDraftPosition(); saveWorkspace()
  activeRequestId = id
  const saved = requestTabs.get(id)
  ;({ draft, draftMode, edited, lastResult, draftPosition } = saved)
  views = { request: 'raw', response: 'raw' }
  selectedId = 0
  browse(null)
}
function addRequest() {
  if (sending) return
  const source = selectedId === null ? draft : chosenResult()?.request ?? original.request
  const credential = selectedId === null ? draftMode : chosenResult()?.credential ?? 'ORIGINAL'
  saveDraftPosition(); saveWorkspace()
  activeRequestId = ++requestSequence
  draft = source; draftMode = credential; edited = false
  lastResult = null; selectedId = 0
  draftPosition = { start: 0, end: 0, top: 0, left: 0 }; views = { request: 'raw', response: 'raw' }
  saveWorkspace(); browse(null); $('request').focus()
}
function removeRequest() {
  if (sending || selectedId === 0 || !activeRequestId) return
  const ids = [...requestTabs.keys()], index = ids.indexOf(activeRequestId)
  const discarded = requestTabs.get(activeRequestId)
  discarded.draft = ''; if (discarded.lastResult) discarded.lastResult.response = ''; discarded.lastResult = null
  if (lastResult) lastResult.response = ''
  requestTabs.delete(activeRequestId)
  activeRequestId = 0; draft = ''; lastResult = null; edited = false
  const next = ids[index + 1] ?? ids[index - 1]
  if (next) selectRequest(next)
  else browse(0)
}
function renderChrome() {
  const item = chosenResult()
  $('response-meta').textContent = item ? item.observed ? '관측 원문' : `${item.duration}ms${edited ? ' · 이전 응답' : ''}` : ''
  $('original').setAttribute('aria-pressed', String(selectedId === 0)); $('original').disabled = sending
  $('add-request').disabled = sending
  $('draft-state').textContent = selectedId === 0 ? '' : sending ? '전송 중' : edited ? '미전송' : ''
  $('send').disabled = sending || selectedId !== null || !draft.trim(); $('send').querySelector('span').textContent = sending ? '전송 중…' : '요청 재전송'
  $('credential').value = selectedId === null ? draftMode : item?.credential ?? draftMode
  $('credential').disabled = sending || selectedId !== null
  $('burp').disabled = sending || selectedId !== null
}
function render() { renderChrome(); renderRequest(); renderResponse(); renderRequests() }
function browse(id) {
  if (sending) return
  saveDraftPosition(); selectedId = id; toast(''); render()
  if (id === null) {
    const input = $('request'); input.setSelectionRange(draftPosition.start, draftPosition.end); input.scrollTop = draftPosition.top; input.scrollLeft = draftPosition.left
    $('request-highlight').scrollTop = input.scrollTop; $('request-highlight').scrollLeft = input.scrollLeft
  } else { $('request').scrollTop = 0; $('request-highlight').scrollTop = 0; $('response-raw').scrollTop = 0 }
}
function simulateSend() {
  if (sending || selectedId !== null || !draft.trim()) return
  if (byteLength(draft) > 1048576) { toast('요청은 UTF-8 기준 1MiB 이하만 입력할 수 있습니다.'); return }
  saveDraftPosition()
  const submittedRequest = draft, scenario = $('scenario').value
  if (lastResult) lastResult.response = ''
  lastResult = null; sending = true; toast(''); render()
  timer = setTimeout(() => {
    let response = sampleResponse(101, submittedRequest.includes('include=items')), status = 200, error = ''
    if (scenario === 'http-error') { response = 'HTTP/1.1 404 Not Found\nContent-Type: application/json\n\n{"message":"Order not found","orderId":999}'; status = 404 }
    if (scenario === 'network-error') { response = ''; status = null; error = '연결에 실패해 응답을 받지 못했습니다.' }
    if (scenario === 'large') response = 'HTTP/1.1 200 OK\nContent-Type: application/json\n\n' + JSON.stringify({ orderId: 101, items: Array.from({ length: 90 }, (_, index) => ({ item: index + 1, name: '합성 상품', quantity: 1 })) }, null, 2)
    lastResult = { response, status, error, duration: scenario === 'slow' ? 2400 : 148 }
    edited = false; sending = false; timer = null; render()
    toast('')
  }, scenario === 'slow' ? 2400 : 700)
}
$('request').addEventListener('input', event => { if (selectedId !== null || sending) return; draft = event.target.value; edited = true; $('request-highlight').innerHTML = highlight(draft); showView('request', draft); renderChrome(); toast('') })
$('request').addEventListener('scroll', event => { $('request-highlight').scrollTop = event.target.scrollTop; $('request-highlight').scrollLeft = event.target.scrollLeft })
// Synthetic credential projection only; never retrieves real credentials.
function applyDemoCredential(mode) {
  const boundary = /\r?\n\r?\n/.exec(draft)
  if (!boundary) { toast('요청의 헤더와 본문 구분을 확인해 주세요. 인증을 바꾸지 않았습니다.'); renderChrome(); return }
  const head = draft.slice(0, boundary.index), body = draft.slice(boundary.index)
  const newline = head.includes('\r\n') ? '\r\n' : '\n'
  const managed = /^(authorization|cookie|proxy-authorization|x-csrf-token|x-xsrf-token|x-csrftoken):/i
  const lines = head.split(/\r?\n/).filter((line, index) => index === 0 || !managed.test(line))
  const headers = mode === 'ANONYMOUS' ? [] : mode === 'ACCOUNT'
    ? ['Authorization: Bearer CURRENT_SESSION_DEMO_USER_1', 'Cookie: session=CURRENT_SESSION_DEMO_USER_1']
    : original.request.split(/\r?\n\r?\n/)[0].split(/\r?\n/).filter(line => managed.test(line))
  lines.splice(2, 0, ...headers)
  draft = lines.join(newline) + body
  draftMode = mode; edited = true; views.request = 'raw'; saveWorkspace(); render(); toast('')
}
$('credential').addEventListener('change', event => { if (!sending && selectedId === null) applyDemoCredential(event.target.value) })
$('send').onclick = simulateSend
$('original').onclick = () => browse(0)
$('request-select').onchange = () => selectRequest(Number($('request-select').value))
$('add-request').onclick = addRequest
$('remove-request').onclick = removeRequest
document.querySelectorAll('[data-pane]').forEach(button => { button.onclick = () => { views[button.dataset.pane] = button.dataset.view; renderRequest(); renderResponse() } })
document.querySelectorAll('[data-focus]').forEach(button => { button.onclick = () => { focus = button.dataset.focus; $('editors').dataset.focus = focus; document.querySelectorAll('[data-focus]').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.focus === focus))) } })
$('basic').onclick = () => { $('stage').style.removeProperty('--dialog-width'); $('stage').style.removeProperty('--dialog-height'); setMaximized(false); focus = 'both'; $('editors').dataset.focus = focus; document.querySelectorAll('[data-focus]').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.focus === focus))); setSplit(50) }
$('font').onchange = () => $('stage').style.setProperty('--font', $('font').value)
$('theme').onchange = () => document.documentElement.dataset.theme = $('theme').value
$('width').onchange = () => document.documentElement.style.setProperty('--review-width', `${$('width').value}px`)
function setMaximized(value) { $('stage').classList.toggle('maximized', value); $('maximize').querySelector('span').textContent = value ? '원래 크기' : '전체화면'; $('maximize').setAttribute('aria-pressed', String(value)) }
$('maximize').onclick = () => setMaximized(!$('stage').classList.contains('maximized'))
$('empty').onclick = () => { if (sending) return; if (!activeRequestId) addRequest(); lastResult = null; selectedId = null; render(); toast('') }
$('reset').onclick = seed
$('burp').onclick = () => toast('목업입니다. 실제 Burp Repeater 연결은 실행하지 않습니다.')
$('close').onclick = () => { requestTabs.clear(); activeRequestId = 0; clearTimeout(timer); timer = null; draft = ''; original = null; lastResult = null; selectedId = null; sending = false; $('request').value = ''; $('request-highlight').textContent = ''; $('response-raw').textContent = ''; $('request-json').textContent = ''; $('response-json').textContent = ''; $('request-select').innerHTML = ''; $('stage').hidden = true; $('closed').hidden = false }
$('reopen').onclick = seed
function setSplit(next) { split = Math.max(25, Math.min(75, next)); $('editors').style.setProperty('--split', `${split}%`); $('splitter').setAttribute('aria-valuenow', String(Math.round(split))) }
$('splitter').onpointerdown = event => { $('splitter').setPointerCapture(event.pointerId) }
$('splitter').onpointermove = event => { if (!$('splitter').hasPointerCapture(event.pointerId)) return; const bounds = $('editors').getBoundingClientRect(); setSplit((event.clientX - bounds.left) / bounds.width * 100) }
$('splitter').onpointerup = event => { if ($('splitter').hasPointerCapture(event.pointerId)) $('splitter').releasePointerCapture(event.pointerId) }
$('splitter').onkeydown = event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); setSplit(event.key === 'Home' ? 25 : event.key === 'End' ? 75 : split + (event.key === 'ArrowLeft' ? -5 : 5)) }
window.addEventListener('keydown', event => { if (event.key === 'Escape' && $('stage').classList.contains('maximized')) setMaximized(false) })
function resizeDialog(width, height) {
  $('stage').style.setProperty('--dialog-width', `${Math.min(window.innerWidth - 32, Math.max(960, width))}px`)
  $('stage').style.setProperty('--dialog-height', `${Math.min(window.innerHeight - 220, Math.max(460, height))}px`)
}
for (const handle of document.querySelectorAll('[data-resize]')) {
  let drag = null
  handle.onpointerdown = event => {
    if (event.button !== 0 || $('stage').classList.contains('maximized')) return
    const box = $('stage').getBoundingClientRect()
    drag = { x: event.clientX, y: event.clientY, width: box.width, height: box.height }
    handle.setPointerCapture(event.pointerId); event.preventDefault()
  }
  handle.onpointermove = event => {
    if (!drag || !handle.hasPointerCapture(event.pointerId)) return
    const direction = handle.dataset.resize.startsWith('left') ? -1 : 1
    resizeDialog(drag.width + 2 * direction * (event.clientX - drag.x), drag.height + (handle.dataset.resize.endsWith('corner') ? event.clientY - drag.y : 0))
  }
  handle.onpointerup = event => { if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId); drag = null }
  handle.onpointercancel = () => { drag = null }
  handle.onkeydown = event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    const box = $('stage').getBoundingClientRect(), direction = handle.dataset.resize.startsWith('left') ? -1 : 1
    resizeDialog(box.width + (event.key === 'ArrowRight' ? 32 * direction : event.key === 'ArrowLeft' ? -32 * direction : 0), box.height + (event.key === 'ArrowDown' ? 16 : event.key === 'ArrowUp' ? -16 : 0))
  }
}
seed()
