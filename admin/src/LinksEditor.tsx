import { LINK_KINDS, type LabelledUrl, type ProjectLinkKind } from './api'

type Props<T extends LabelledUrl & { kind?: ProjectLinkKind }> = {
  legend: string
  items: T[]
  onChange: (items: T[]) => void
  // Project links carry a kind; profile links and badges do not.
  newItem: () => T
  withKind?: boolean
}

export function LinksEditor<T extends LabelledUrl & { kind?: ProjectLinkKind }>({ legend, items, onChange, newItem, withKind }: Props<T>) {
  const patch = (i: number, p: Partial<T>) => onChange(items.map((it, j) => (j === i ? { ...it, ...p } : it)))
  return (
    <fieldset class="links-editor">
      <legend>{legend}</legend>
      {items.map((it, i) => (
        <div class="link-row" key={i}>
          {withKind && (
            <select aria-label="Kind" value={it.kind} onChange={(e) => patch(i, { kind: e.currentTarget.value as ProjectLinkKind } as Partial<T>)}>
              {LINK_KINDS.map((k) => (
                <option value={k}>{k}</option>
              ))}
            </select>
          )}
          <input aria-label="Label" placeholder="Label" value={it.label} onInput={(e) => patch(i, { label: e.currentTarget.value } as Partial<T>)} />
          <input aria-label="URL" placeholder="https://" type="url" value={it.url} onInput={(e) => patch(i, { url: e.currentTarget.value } as Partial<T>)} />
          <button type="button" aria-label={`Remove ${legend} ${i + 1}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
            Remove
          </button>
        </div>
      ))}
      <div>
        <button type="button" onClick={() => onChange([...items, newItem()])}>
          Add
        </button>
      </div>
    </fieldset>
  )
}
