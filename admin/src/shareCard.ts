import { api } from './api'

// Share cards are drawn here and uploaded on save: rendering one in the Worker would not fit its CPU limit.
export type CardSpec = { errorLine: string | null; title: string; label: string }

const WIDTH = 1200
const HEIGHT = 630
const MARGIN = 80
const BG = '#171a1f'
const FG = '#e9e6de'
const MUTED = '#a39e93'
const ACCENT = '#f2a93b'
const SANS = '"IBM Plex Sans", system-ui, sans-serif'
const MONO = '"IBM Plex Mono", ui-monospace, monospace'

// A note's card leads with the exact error: the longest code span long enough to be one, else the first sentence.
export function errorLineOf(symptom: string): string {
  const spans = [...symptom.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? '').filter((s) => s.length >= 12)
  const longest = spans.sort((a, b) => b.length - a.length)[0]
  return longest ?? (symptom.split(/(?<=[.!?])\s/)[0] ?? symptom).replaceAll('`', '')
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word
    if (ctx.measureText(next).width <= maxWidth || !line) line = next
    else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  kept[maxLines - 1] = `${kept[maxLines - 1]}...`
  return kept
}

function draw(ctx: CanvasRenderingContext2D, spec: CardSpec) {
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, WIDTH, HEIGHT)
  ctx.textBaseline = 'alphabetic'

  ctx.font = `500 36px ${MONO}`
  ctx.fillStyle = ACCENT
  ctx.fillText('~/', MARGIN, MARGIN + 28)
  const prefix = ctx.measureText('~/').width
  ctx.fillStyle = FG
  ctx.fillText('ismail', MARGIN + prefix, MARGIN + 28)

  let y = MARGIN + 110
  if (spec.errorLine) {
    ctx.font = `400 30px ${MONO}`
    ctx.fillStyle = MUTED
    for (const l of wrap(ctx, spec.errorLine, WIDTH - MARGIN * 2, 2)) {
      ctx.fillText(l, MARGIN, y)
      y += 42
    }
    y += 22
  }

  ctx.font = `600 58px ${SANS}`
  ctx.fillStyle = FG
  for (const l of wrap(ctx, spec.title, WIDTH - MARGIN * 2, spec.errorLine ? 3 : 4)) {
    y += 14
    ctx.fillText(l, MARGIN, y + 44)
    y += 58
  }

  ctx.font = `400 28px ${SANS}`
  ctx.fillStyle = MUTED
  ctx.fillText(spec.label, MARGIN, HEIGHT - MARGIN + 10)
}

export async function renderCard(spec: CardSpec): Promise<Blob> {
  const sample = `${spec.errorLine ?? ''} ${spec.title} ${spec.label}`
  await Promise.all([
    document.fonts.load(`600 58px "IBM Plex Sans"`, sample),
    document.fonts.load(`400 28px "IBM Plex Sans"`, sample),
    document.fonts.load(`500 36px "IBM Plex Mono"`, '~/ismail'),
    document.fonts.load(`400 30px "IBM Plex Mono"`, sample),
  ])
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas is not available')
  draw(ctx, spec)
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('could not encode the card'))), 'image/png'))
}

// The key to save with the page. A card is drawn only when its text changed; a failed upload must not cost the save.
export async function shareCardKey(spec: CardSpec, previous: CardSpec | null, currentKey: string | null): Promise<string | null> {
  if (currentKey && JSON.stringify(spec) === JSON.stringify(previous)) return currentKey
  try {
    const blob = await renderCard(spec)
    const file = new File([blob], 'share-card.png', { type: 'image/png' })
    const res = await api.upload(file, `Share card: ${spec.title}`, WIDTH, HEIGHT)
    return res.url.replace(/^\/media\//, '')
  } catch (e) {
    console.error('share card', e)
    return currentKey
  }
}
