import { describe, expect, it } from 'vitest'
import { isSafeHttpUrl, safeRedirectTarget } from './redirect'

describe('safeRedirectTarget', () => {
  it('allows a same-site path', () => {
    expect(safeRedirectTarget('/notes/old', '/notes/new')).toBe('/notes/new')
  })

  it.each(['//evil.com', '/\\evil.com', 'https://evil.com/x', 'notes/new', ''])('refuses %s', (to) => {
    expect(safeRedirectTarget('/notes/old', to)).toBeNull()
  })

  it('refuses a redirect to itself so a bad row cannot loop the browser', () => {
    expect(safeRedirectTarget('/old', '/old')).toBeNull()
  })
})

describe('isSafeHttpUrl', () => {
  it('accepts http(s) and refuses script URLs', () => {
    expect(isSafeHttpUrl('https://git.kernel.org/linus/c/59c3ee19ca88')).toBe(true)
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false)
  })
})
