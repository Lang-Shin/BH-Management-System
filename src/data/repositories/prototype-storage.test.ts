import { describe, expect, it, vi } from 'vitest'
import { createDemoData } from '@/data/fixtures/demo'
import { parsePrototypeSnapshot } from './prototype-storage'
import { localStorageRepository, STORAGE_KEY } from './local-storage-repository'

describe('safe prototype snapshot parsing', () => {
  it('returns validated typed data from a supported envelope', () => {
    const data = createDemoData()
    expect(parsePrototypeSnapshot(JSON.stringify({ version: 2, data }))).toEqual({ ok: true, data })
  })

  it.each([
    ['{broken', 'MALFORMED_JSON'], ['null', 'INVALID_DATA'], ['[]', 'INVALID_DATA'],
    [JSON.stringify({ version: 1, data: createDemoData() }), 'UNSUPPORTED_SCHEMA'],
    [JSON.stringify({ version: 2, data: { tenants: [] } }), 'INVALID_DATA'],
  ])('handles invalid input without throwing: %s', (raw, reason) => {
    expect(parsePrototypeSnapshot(raw)).toEqual({ ok: false, reason })
  })
})

describe('repository initialization and safe writes', () => {
  it('initializes fresh fictional data without modifying storage during load', async () => {
    const write = vi.spyOn(Storage.prototype, 'setItem')
    const first = await localStorageRepository.load()
    expect(first).toEqual({ data: createDemoData(), warning: null, canPersist: true })
    first.data.tenants[0]!.notes = 'Session-only example'
    expect((await localStorageRepository.load()).data.tenants[0]?.notes).toBe('')
    expect(write).not.toHaveBeenCalled()
  })

  it('refuses invalid writes and preserves the last valid saved snapshot', async () => {
    const valid = createDemoData()
    await localStorageRepository.save(valid)
    const saved = localStorage.getItem(STORAGE_KEY)
    const invalid = createDemoData()
    invalid.payments[0]!.amountCents = -1
    expect(await localStorageRepository.save(invalid)).toContain('failed validation')
    expect(localStorage.getItem(STORAGE_KEY)).toBe(saved)
    expect((await localStorageRepository.load()).data).toEqual(valid)
  })
})
