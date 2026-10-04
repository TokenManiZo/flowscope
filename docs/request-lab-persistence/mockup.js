// Synthetic approval prototype only: no fetch, browser storage, real credentials or HTTP transmission.
const $ = id => document.getElementById(id)
const original = { request: 'POST /api/orders/preview HTTP/1.1\nHost: api.example.test\nContent-Type: application/json\nCookie: ***MASKED***\n\n{"items":[{"sku":"NOTE-01","quantity":2}]}', response: 'HTTP/1.1 200 OK\nContent-Type: application/json\n\n{"status":"preview","amount":23900}' }
let items = [{ id: 1, name: '주문 확인', request: original.request, response: original.response, status: 200, credentialMode: 'ORIGINAL', dirty: false, restored: false }, { id: 2, name: '수량 변경', request: original.request.replace('"quantity":2', '"quantity":3'), response: '', status: 0, credentialMode: 'ORIGINAL', dirty: false, restored: false }]
let selected = 1, sequence = 2, timer = null, revision = 0, savedRevision = -1, saved = null
const escape = text => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
const current = () => items.find(item => item.id === selected)
// Deliberately narrow sample masking. Production must reuse and verify server-side Masking boundaries.
const mask = text => text.replace(/^(Authorization|Cookie|Set-Cookie|X-CSRF-Token):[^\r\n]*/gim, '$1: ***MASKED***')
function color(text) { return escape(text).replace(/^([\w-]+:)/gm, '<span class="key">$1</span>').replace(/^(POST|GET|HTTP\/1\.1)/gm, '<span class="method">$1</span>') }
function paintRequest() { $('highlight').innerHTML = color($('request').value) }
function markChanged() { revision++; $('saved').textContent = '저장 대기'; $('saved').classList.remove('failed'); clearTimeout(timer); timer = setTimeout(save, 800) }
function save() {
  clearTimeout(timer)
  if (savedRevision === revision) return true
  if ($('scenario').value === 'failure') { $('saved').textContent = '저장 실패'; $('saved').classList.add('failed'); $('retry').hidden = false; return false }
  saved = { items: items.map(item => ({ ...item, request: mask(item.request), response: mask(item.response), restored: true })), selected, sequence }
  savedRevision = revision; $('saved').textContent = '프로젝트 저장됨'; $('saved').classList.remove('failed'); $('retry').hidden = true
  return true
}
function render() {
  const item = current()
  $('requests').replaceChildren(new Option('요청 선택', ''))
  $('requests').firstChild.disabled = true
  for (const value of items) $('requests').add(new Option(value.name, String(value.id)))
  $('requests').value = item ? String(item.id) : ''; $('requests').hidden = !items.length
  $('original').setAttribute('aria-pressed', String(!item)); $('requests').classList.toggle('selected', Boolean(item))
  $('name').hidden = true; $('name').value = ''; $('rename').disabled = !item; $('remove').disabled = !item
  $('credential').value = item?.credentialMode ?? 'ORIGINAL'; $('credential').disabled = !item
  $('request').value = item?.request ?? original.request; $('request').readOnly = !item; $('edit-state').textContent = item ? '편집 가능' : '읽기 전용'
  $('response').innerHTML = color(item?.response ?? original.response); $('http-status').textContent = item ? item.status ? `HTTP ${item.status}` : '미전송' : 'HTTP 200'
  $('response-state').textContent = item?.dirty && item.response ? '이전 응답' : ''
  const needsAuth = item?.restored && item.credentialMode === 'ORIGINAL' && item.request.includes('***MASKED***')
  $('notice').hidden = !needsAuth; $('notice-text').textContent = '저장본의 인증값은 마스킹되어 있습니다. 전송 인증을 다시 선택해 주세요.'; $('discard').hidden = true; $('send').disabled = !item || needsAuth
  paintRequest()
}
function finishRename(cancel = false) {
  const item = current(), value = $('name').value.trim().slice(0, 80)
  if (!cancel && item && value && value !== item.name) { item.name = value; markChanged() }
  render()
}
$('rename').onclick = () => { $('requests').hidden = true; $('name').hidden = false; $('name').value = current().name; $('name').focus(); $('name').select() }
$('name').onblur = () => { if (!$('name').hidden) finishRename() }
$('name').onkeydown = event => { if (!event.isComposing && ['Enter', 'Escape'].includes(event.key)) { event.preventDefault(); finishRename(event.key === 'Escape'); $('request').focus() } }
$('requests').onchange = () => { selected = Number($('requests').value); render(); markChanged() }
$('original').onclick = () => { selected = 0; render(); markChanged() }
$('request').oninput = () => { const item = current(); if (!item) return; item.request = $('request').value; item.dirty = true; $('response-state').textContent = item.response ? '이전 응답' : ''; paintRequest(); markChanged() }
$('request').onscroll = () => { $('highlight').scrollTop = $('request').scrollTop; $('highlight').scrollLeft = $('request').scrollLeft }
$('add').onclick = () => { const item = current(); const id = ++sequence; items.push({ id, name: `요청 ${id}`, request: item?.request ?? original.request, response: '', status: 0, credentialMode: item?.credentialMode ?? 'ORIGINAL', dirty: false, restored: Boolean(item?.restored) }); selected = id; render(); markChanged() }
$('remove').onclick = () => {
  const index = items.findIndex(item => item.id === selected); if (index < 0) return
  if ($('scenario').value === 'failure') { $('notice').hidden = false; $('notice-text').textContent = '삭제하지 못했습니다. 요청을 유지했습니다. 저장 상태를 확인한 뒤 다시 삭제해 주세요.'; return }
  items.splice(index, 1); selected = items[index]?.id ?? items[index - 1]?.id ?? 0
  revision++; save(); render()
}
$('credential').onchange = () => { const item = current(); if (!item) return; item.credentialMode = $('credential').value; item.request = item.request.replace(/^Cookie:[^\r\n]*\n?/gim, ''); if (item.credentialMode === 'ACCOUNT') item.request = item.request.replace(/\n\n/, '\nCookie: DEMO_SESSION_ONLY\n\n'); item.dirty = true; render(); markChanged() }
$('send').onclick = () => { const item = current(); if (!item || $('send').disabled) return; item.response = 'HTTP/1.1 200 OK\nContent-Type: application/json\nSet-Cookie: DEMO_RESPONSE_ONLY\n\n{"status":"confirmed","amount":23900}'; item.status = 200; item.dirty = false; render(); markChanged() }
function hideEditor() { items = []; $('request').value = ''; $('highlight').textContent = ''; $('response').textContent = ''; $('name').value = ''; $('stage').hidden = true; $('closed').hidden = false }
function close() { if (!save()) { $('notice').hidden = false; $('notice-text').textContent = '저장하지 못했습니다. 요청은 열어 둡니다. 다시 저장해 주세요.'; $('discard').hidden = false; return } hideEditor() }
function reopen() { if (!saved) return; items = saved.items.map(item => ({ ...item })); selected = saved.selected; sequence = saved.sequence; $('stage').hidden = false; $('closed').hidden = true; render() }
$('close').onclick = close; $('reopen').onclick = reopen
$('discard').onclick = () => { clearTimeout(timer); revision = savedRevision; hideEditor() }
$('restart').onclick = () => { if (save()) { close(); reopen() } }
$('retry').onclick = save
$('theme').onchange = () => { document.documentElement.dataset.theme = $('theme').value }
$('font').onchange = () => { document.documentElement.style.setProperty('--font', $('font').value) }
$('maximize').onclick = () => { const full = $('stage').classList.toggle('maximized'); $('maximize').textContent = full ? '원래 크기' : '전체화면' }
render(); markChanged()
