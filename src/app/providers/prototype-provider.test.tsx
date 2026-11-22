import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { createDemoData } from '@/data/fixtures/demo'
import type { PrototypeRepository, PrototypeSnapshot } from '@/data/repositories/prototype-repository'
import { usePrototype } from '@/hooks/use-prototype'
import { PrototypeProvider } from './prototype-provider'

function Consumer() {
  const { data, dispatch, storageWarning } = usePrototype()
  return <><p>{data.tenants.length} residents loaded</p>{storageWarning && <p role="alert">{storageWarning}</p>}<button onClick={() => dispatch({ type: 'tenant/noteUpdated', tenantId: 'tenant-1', notes: 'Injected adapter note' })}>Change note</button></>
}

function ServerConsumer() {
  const { data, dispatch, commandError, pendingCommands, retryCommand } = usePrototype()
  return <>
    <p>{data.tenants[0]?.notes || 'empty'}</p>
    <p role="status">{commandError ?? 'no command error'}</p>
    <p>Pending: {pendingCommands}</p>
    <button onClick={() => dispatch({ type: 'tenant/noteUpdated', tenantId: 'tenant-1', notes: 'Injected adapter note' })}>Change note</button>
    <button onClick={retryCommand}>Retry command</button>
  </>
}

function CommitConsumer() {
  const { data, commitAction } = usePrototype()
  const [result, setResult] = useState('idle')
  return <>
    <p>{data.tenants[0]?.notes || 'empty'}</p>
    <p role="status">Commit: {result}</p>
    <button onClick={async () => {
      const confirmed = await commitAction({ type: 'tenant/noteUpdated', tenantId: 'tenant-1', notes: 'Server-confirmed note' })
      setResult(confirmed ? 'confirmed' : 'failed')
    }}>Commit note</button>
  </>
}

describe('repository injection boundary', () => {
  it('waits for asynchronous loading and serializes saves through an injected adapter', async () => {
    localStorage.clear()
    let resolveLoad!: (snapshot: PrototypeSnapshot) => void
    let finishFirstSave!: (warning: string | null) => void
    const load = vi.fn(() => new Promise<PrototypeSnapshot>(resolve => { resolveLoad = resolve }))
    const save = vi.fn<PrototypeRepository['save']>()
      .mockImplementationOnce(() => new Promise(resolve => { finishFirstSave = resolve }))
      .mockResolvedValue(null)
    render(<PrototypeProvider repository={{ load, save }}><Consumer /></PrototypeProvider>)
    expect(screen.getByRole('status', { name: 'Opening records' })).toBeInTheDocument()
    expect(save).not.toHaveBeenCalled()
    await act(async () => resolveLoad({ data: createDemoData(), warning: null, canPersist: true }))
    expect(await screen.findByText('10 residents loaded')).toBeInTheDocument()
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
    expect(await screen.findByRole('heading', { name: 'Your records could not be opened' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(repository.save).not.toHaveBeenCalled()
  })

  it('uses server commands, reverts rejected changes, and retries with the same idempotency key', async () => {
    const initial = createDemoData()
    initial.tenants[0]!.notes = 'Original note'
    const updated = createDemoData()
    updated.tenants[0]!.notes = 'Injected adapter note'
    const command = vi.fn<NonNullable<PrototypeRepository['command']>>()
      .mockRejectedValueOnce(new Error('Server rejected the change'))
      .mockResolvedValueOnce({ data: updated, revision: 2, replayed: false })
    const save = vi.fn().mockResolvedValue(null)
    const repository: PrototypeRepository = {
      mode: 'server',
      load: async () => ({ data: initial, warning: null, canPersist: true, revision: 1 }),
      save,
      command,
    }
    render(<PrototypeProvider repository={repository}><ServerConsumer /></PrototypeProvider>)
    expect(await screen.findByText('Original note')).toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Change note' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Server rejected the change'))
    expect(screen.getByText('Original note')).toBeInTheDocument()
    expect(screen.getByText('Pending: 0')).toBeInTheDocument()
    expect(save).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Retry command' }))
    await waitFor(() => expect(screen.getByText('Injected adapter note')).toBeInTheDocument())
    expect(screen.getByRole('status')).toHaveTextContent('no command error')
    expect(command).toHaveBeenCalledTimes(2)
    expect(command.mock.calls[0]![1]).toBe(command.mock.calls[1]![1])
  })

  it('does not apply a committed financial-style action until the server confirms it', async () => {
    const initial = createDemoData()
    initial.tenants[0]!.notes = 'Original note'
    const confirmed = createDemoData()
    confirmed.tenants[0]!.notes = 'Server-confirmed note'
    let resolveCommand!: (value: { data: typeof confirmed; revision: number; replayed: boolean }) => void
    const command = vi.fn<NonNullable<PrototypeRepository['command']>>(() =>
      new Promise(resolve => { resolveCommand = resolve }))
    const repository: PrototypeRepository = {
      mode: 'server',
      load: async () => ({ data: initial, warning: null, canPersist: true, revision: 1 }),
      save: vi.fn().mockResolvedValue(null),
      command,
    }
    render(<PrototypeProvider repository={repository}><CommitConsumer /></PrototypeProvider>)
    expect(await screen.findByText('Original note')).toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Commit note' }))
    expect(screen.getByText('Original note')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Commit: idle')
    await act(async () => resolveCommand({ data: confirmed, revision: 2, replayed: false }))
    await waitFor(() => expect(screen.getByText('Server-confirmed note')).toBeInTheDocument())
    expect(screen.getByRole('status')).toHaveTextContent('Commit: confirmed')
  })

  it('retains the session and warns if an asynchronous adapter rejects saving', async () => {
    const repository: PrototypeRepository = {
      load: async () => ({ data: createDemoData(), warning: null, canPersist: true }),
      save: vi.fn().mockRejectedValue(new Error('Unavailable')),
    }
    render(<PrototypeProvider repository={repository}><Consumer /></PrototypeProvider>)
    expect(await screen.findByText('10 residents loaded')).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('Your changes could not be saved')
  })
})
