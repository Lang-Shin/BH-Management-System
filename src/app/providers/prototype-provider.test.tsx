import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createDemoData } from '@/data/fixtures/demo'
import type { PrototypeRepository, PrototypeSnapshot } from '@/data/repositories/prototype-repository'
import { usePrototype } from '@/hooks/use-prototype'
import { PrototypeProvider } from './prototype-provider'

function Consumer() {
  const { data, dispatch, storageWarning } = usePrototype()
  return <><p>{data.tenants.length} residents loaded</p>{storageWarning && <p role="alert">{storageWarning}</p>}<button onClick={() => dispatch({ type: 'tenant/noteUpdated', tenantId: 'tenant-1', notes: 'Injected adapter note' })}>Change note</button></>
}

describe('repository injection boundary', () => {
  it('waits for asynchronous loading and serializes saves through an injected adapter', async () => {
    let resolveLoad!: (snapshot: PrototypeSnapshot) => void
    let finishFirstSave!: (warning: string | null) => void
    const load = vi.fn(() => new Promise<PrototypeSnapshot>(resolve => { resolveLoad = resolve }))
    const save = vi.fn<PrototypeRepository['save']>()
      .mockImplementationOnce(() => new Promise(resolve => { finishFirstSave = resolve }))
      .mockResolvedValue(null)
    render(<PrototypeProvider repository={{ load, save }}><Consumer /></PrototypeProvider>)
    expect(screen.getByRole('status', { name: 'Loading module' })).toBeInTheDocument()
    expect(save).not.toHaveBeenCalled()
    await act(async () => resolveLoad({ data: createDemoData(), warning: null, canPersist: true }))
    expect(await screen.findByText('22 residents loaded')).toBeInTheDocument()
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Change note' }))
    expect(save).toHaveBeenCalledTimes(1)
    await act(async () => finishFirstSave(null))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(save.mock.calls[1]?.[0].tenants[0]?.notes).toBe('Injected adapter note')
    expect(localStorage.length).toBe(0)
  })

  it('provides a recoverable error state when an asynchronous adapter rejects loading', async () => {
    const repository: PrototypeRepository = {
      load: vi.fn().mockRejectedValue(new Error('Unavailable')),
      save: vi.fn().mockResolvedValue(null),
    }
    render(<PrototypeProvider repository={repository}><Consumer /></PrototypeProvider>)
    expect(await screen.findByRole('heading', { name: 'Workspace could not be loaded' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload application' })).toBeInTheDocument()
    expect(repository.save).not.toHaveBeenCalled()
  })

  it('retains the session and warns if an asynchronous adapter rejects saving', async () => {
    const repository: PrototypeRepository = {
      load: async () => ({ data: createDemoData(), warning: null, canPersist: true }),
      save: vi.fn().mockRejectedValue(new Error('Unavailable')),
    }
    render(<PrototypeProvider repository={repository}><Consumer /></PrototypeProvider>)
    expect(await screen.findByText('22 residents loaded')).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('Demo changes could not be saved')
  })
})
