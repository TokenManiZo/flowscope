/** Frame the top of the graph at a readable scale. Vertical growth is navigated
 * by panning, rather than shrinking every card to fit the whole graph. */
export function readableGraphViewport(nodes: readonly { x: number; y: number; width: number; height: number }[], canvasWidth: number) {
  if (!nodes.length || canvasWidth <= 0) return null
  const left = Math.min(...nodes.map(node => node.x - node.width / 2))
  const right = Math.max(...nodes.map(node => node.x + node.width / 2))
  const top = Math.min(...nodes.map(node => node.y - node.height / 2))
  const zoom = Math.max(0.65, Math.min(1, (canvasWidth - 48) / Math.max(1, right - left)))
  return { zoom, pan: { x: canvasWidth / 2 - (left + right) / 2 * zoom, y: 64 - top * zoom } }
}
