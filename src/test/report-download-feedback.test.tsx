import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AppRouter } from '@/app/router/app-router'
import { PrototypeProvider } from '@/app/providers/prototype-provider'
import { localStorageRepository } from '@/data/repositories/local-storage-repository'

function openReports() {
  render(<PrototypeProvider repository={localStorageRepository}><MemoryRouter initialEntries={['/reports']}><AppRouter /></MemoryRouter></PrototypeProvider>)
}

describe('room report download feedback', () => {
  it('announces a requested download without claiming it completed', async () => {
    const user = userEvent.setup()
    const create = vi.fn(() => 'blob:room-report')
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = create
      static revokeObjectURL = vi.fn()
    })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    try {
      openReports()
      await user.click(await screen.findByRole('button', { name: 'Download room CSV' }))
      expect(create).toHaveBeenCalledWith(expect.any(Blob))
      expect(click).toHaveBeenCalledOnce()
      expect(screen.getByText('Room CSV download requested. Check your browser downloads.')).toHaveAttribute('role', 'status')
      await new Promise(resolve => setTimeout(resolve, 1100))
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('announces preparation errors and allows retry', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = vi.fn(() => { throw new Error('Download unavailable') })
    })
    try {
      openReports()
      const button = await screen.findByRole('button', { name: 'Download room CSV' })
      await user.click(button)
      expect(screen.getByRole('alert')).toHaveTextContent('The room CSV could not be prepared. Try downloading it again.')
      expect(button).toBeEnabled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
