import { beforeEach, describe, expect, it, vi } from 'vitest'

const { headerReader } = vi.hoisted(() => ({
  headerReader: vi.fn(),
}))

vi.mock('next/headers', () => ({
  headers: headerReader,
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}))

import { getChatGPTUser } from './chatgpt-auth'

function requestHeaders(values: Record<string, string>) {
  return {
    get: (name: string) => values[name] ?? null,
  }
}

describe('Sites ChatGPT identity', () => {
  beforeEach(() => {
    headerReader.mockReset()
  })

  it('requires both the stable user id and email', async () => {
    const partialIdentityCases: Array<Record<string, string>> = [
      {},
      { 'oai-authenticated-user-email': 'friend@example.com' },
      { 'oai-authenticated-user-id': 'friend-user' },
    ]
    for (const values of partialIdentityCases) {
      headerReader.mockResolvedValueOnce(requestHeaders(values))
      await expect(getChatGPTUser()).resolves.toBeNull()
    }
  })

  it('uses only platform identity headers and safely decodes an optional name', async () => {
    headerReader.mockResolvedValueOnce(requestHeaders({
      'oai-authenticated-user-id': 'friend-user',
      'oai-authenticated-user-email': 'friend@example.com',
      'oai-authenticated-user-full-name': 'Andy%20Cooper',
      'oai-authenticated-user-full-name-encoding': 'percent-encoded-utf-8',
    }))
    await expect(getChatGPTUser()).resolves.toEqual({
      userId: 'friend-user',
      email: 'friend@example.com',
      fullName: 'Andy Cooper',
      displayName: 'Andy Cooper',
    })
  })
})
