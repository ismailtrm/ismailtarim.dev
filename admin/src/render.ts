// Markdown -> stored HTML. Runs in the browser at save time; the Worker never renders Markdown
// (Workers Free allows 10 ms of CPU per request). Conventions it produces are styled in
// public/styles.css: .code frames, .t1-.t9 token colours, .sidenote, numbered figures.
import MarkdownIt from 'markdown-it'
import footnote from 'markdown-it-footnote'
import { createHighlighterCoreSync, type ShikiTransformer, type ThemeRegistrationRaw } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import bash from 'shiki/dist/langs/bash.mjs'
import c from 'shiki/dist/langs/c.mjs'
import css from 'shiki/dist/langs/css.mjs'
import diff from 'shiki/dist/langs/diff.mjs'
import dockerfile from 'shiki/dist/langs/dockerfile.mjs'
import go from 'shiki/dist/langs/go.mjs'
import html from 'shiki/dist/langs/html.mjs'
import ini from 'shiki/dist/langs/ini.mjs'
import javascript from 'shiki/dist/langs/javascript.mjs'
import json from 'shiki/dist/langs/json.mjs'
import jsonc from 'shiki/dist/langs/jsonc.mjs'
import python from 'shiki/dist/langs/python.mjs'
import rust from 'shiki/dist/langs/rust.mjs'
import shellsession from 'shiki/dist/langs/shellsession.mjs'
import sql from 'shiki/dist/langs/sql.mjs'
import toml from 'shiki/dist/langs/toml.mjs'
import tsx from 'shiki/dist/langs/tsx.mjs'
import typescript from 'shiki/dist/langs/typescript.mjs'
import yaml from 'shiki/dist/langs/yaml.mjs'

// Tokens are coloured by class, not inline style: the public CSP has no 'unsafe-inline' for
// styles, and classes let the light and dark themes recolour code. The theme below only
// tags each scope group with a placeholder colour that the transformer turns into a class.
const GROUPS: [string, string[]][] = [
  ['#000001', ['comment', 'punctuation.definition.comment']],
  ['#000002', ['keyword', 'storage', 'keyword.control', 'keyword.operator.new', 'keyword.operator.expression']],
  ['#000003', ['string', 'punctuation.definition.string', 'markup.inline.raw']],
  ['#000004', ['constant.numeric', 'constant.language', 'constant.character', 'constant.other']],
  ['#000005', ['entity.name.function', 'support.function', 'meta.function-call.generic']],
  ['#000006', ['entity.name.type', 'entity.name.class', 'support.type', 'support.class', 'storage.type.primitive']],
  ['#000007', ['variable.parameter', 'entity.other.attribute-name', 'entity.name.tag']],
  ['#000008', ['markup.inserted', 'punctuation.definition.inserted']],
  ['#000009', ['markup.deleted', 'punctuation.definition.deleted']],
]

const theme: ThemeRegistrationRaw = {
  name: 'site-classes',
  type: 'light',
  settings: [{ settings: { foreground: '#000000', background: '#ffffff' } }, ...GROUPS.map(([color, scope]) => ({ scope, settings: { foreground: color } }))],
}

const toClasses: ShikiTransformer = {
  pre(node) {
    delete node.properties.style
    delete node.properties.tabindex
    node.properties.class = 'shiki'
  },
  span(node) {
    const style = String(node.properties.style ?? '')
    delete node.properties.style
    const m = /color:#00000([1-9])/i.exec(style)
    if (m) node.properties.class = `t${m[1]}`
  },
}

const LANGS = [bash, c, css, diff, dockerfile, go, html, ini, javascript, json, jsonc, python, rust, shellsession, sql, toml, tsx, typescript, yaml]
const ALIASES: Record<string, string> = { sh: 'bash', shell: 'bash', zsh: 'bash', console: 'shellsession', ts: 'typescript', js: 'javascript', py: 'python', yml: 'yaml', golang: 'go', rs: 'rust' }

const highlighter = createHighlighterCoreSync({ themes: [theme], langs: LANGS.flat(), engine: createJavaScriptRegexEngine() })
const loaded = new Set(highlighter.getLoadedLanguages())

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const md = new MarkdownIt({ html: true, linkify: true, typographer: false }).use(footnote)

// ```ts src/index.ts  ->  a frame titled "src/index.ts". The title is optional.
md.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx]!
  const [rawLang = '', ...rest] = token.info.trim().split(/\s+/)
  const lang = ALIASES[rawLang] ?? rawLang
  const title = rest.join(' ')
  const code = token.content.replace(/\n$/, '')
  const body = loaded.has(lang)
    ? highlighter.codeToHtml(code, { lang, theme: 'site-classes', transformers: [toClasses] })
    : `<pre class="shiki"><code>${escapeHtml(code)}</code></pre>`
  const label = title || rawLang
  const head = label ? `<figcaption><span>${escapeHtml(label)}</span><button type="button" class="copy" data-copy>Copy</button></figcaption>` : ''
  return `<figure class="code">${head}${body}</figure>\n`
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/ı/g, 'i')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Structure that is easier to build on the DOM than inside markdown-it: heading anchors,
// sidenotes next to their reference, and numbered figures for standalone images.
function finish(raw: string): string {
  const doc = new DOMParser().parseFromString(`<div id="root">${raw}</div>`, 'text/html')
  const root = doc.getElementById('root')!

  const seen = new Map<string, number>()
  for (const h of root.querySelectorAll('h2, h3')) {
    const base = slugify(h.textContent ?? '') || 'section'
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    h.id = n === 1 ? base : `${base}-${n}`
  }

  const notes = root.querySelector('section.footnotes')
  if (notes) {
    for (const li of notes.querySelectorAll('li[id]')) {
      const ref = root.querySelector(`a[href="#${CSS.escape(li.id)}"]`)
      const sup = ref?.closest('sup')
      if (!sup) continue
      li.querySelectorAll('a.footnote-backref').forEach((a) => a.remove())
      const n = sup.textContent?.replace(/\D/g, '') ?? ''
      const label = doc.createElement('label')
      label.className = 'sidenote-ref'
      label.htmlFor = `sn-${n}`
      label.textContent = n
      const toggle = doc.createElement('input')
      toggle.type = 'checkbox'
      toggle.id = `sn-${n}`
      toggle.className = 'sidenote-toggle'
      const note = doc.createElement('span')
      note.className = 'sidenote'
      note.innerHTML = `<span class="num">${n}</span> ` + Array.from(li.querySelectorAll('p')).map((p) => p.innerHTML).join(' ')
      sup.replaceWith(label, toggle, note)
    }
    notes.previousElementSibling?.matches('hr.footnotes-sep') && notes.previousElementSibling.remove()
    notes.remove()
  }

  let fig = 0
  for (const p of Array.from(root.querySelectorAll('p'))) {
    const img = p.querySelector(':scope > img')
    if (!img || p.childNodes.length !== 1) continue
    fig += 1
    const figure = doc.createElement('figure')
    figure.className = 'figure'
    figure.id = `fig-${fig}`
    img.setAttribute('loading', 'lazy')
    const caption = doc.createElement('figcaption')
    caption.textContent = `Fig. ${fig}. ${img.getAttribute('title') || img.getAttribute('alt') || ''}`.trim()
    img.removeAttribute('title')
    figure.append(img, caption)
    p.replaceWith(figure)
  }

  return root.innerHTML
}

export function render(markdown: string): string {
  return finish(md.render(markdown))
}
