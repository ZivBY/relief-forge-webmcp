import { describe, expect, it } from 'vitest'

import { resolveSitesEntryAction } from './entry-gate'

describe('Sites entry gate', () => {
  it('requires both trusted identity headers at the protected root', () => {
    expect(resolveSitesEntryAction('/', null, null)).toBe('sign-in')
    expect(resolveSitesEntryAction('/', null, 'friend@example.com')).toBe('sign-in')
    expect(resolveSitesEntryAction('/', 'friend-user', null)).toBe('sign-in')
    expect(resolveSitesEntryAction('/', 'friend-user', 'friend@example.com')).toBe('allow')
  })

  it('recovers only a fully authenticated Sites callback', () => {
    expect(resolveSitesEntryAction('/callback', null, null)).toBe('pass-through')
    expect(resolveSitesEntryAction('/callback', null, 'friend@example.com')).toBe('pass-through')
    expect(resolveSitesEntryAction('/callback', 'friend-user', null)).toBe('pass-through')
    expect(
      resolveSitesEntryAction('/callback', 'friend-user', 'friend@example.com'),
    ).toBe('recover-callback')
  })

  it('does not turn unrelated paths into an authentication surface', () => {
    expect(resolveSitesEntryAction('/api/feedback', null, null)).toBe('pass-through')
    expect(
      resolveSitesEntryAction('/signin-with-chatgpt', 'friend-user', 'friend@example.com'),
    ).toBe('pass-through')
  })
})
