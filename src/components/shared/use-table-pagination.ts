import { useState } from 'react'

export const PAGE_SIZE_OPTIONS = [5, 10, 20, 50] as const
export type PageSize = typeof PAGE_SIZE_OPTIONS[number]
type ResetKey = string | number | boolean | null | undefined

export function useTablePagination<T>(rows: readonly T[], resetKey?: ResetKey) {
  const datasetKey = `${String(resetKey ?? '')}:${rows.length}`
  const [state, setState] = useState<{ page: number; pageSize: PageSize; datasetKey: string }>({ page: 1, pageSize: 10, datasetKey })
  const page = state.datasetKey === datasetKey ? state.page : 1
  const pageSize = state.pageSize
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const startIndex = rows.length === 0 ? 0 : (currentPage - 1) * pageSize
  const visibleRows = rows.slice(startIndex, startIndex + pageSize)

  function setPage(nextPage: number) {
    setState(current => ({ ...current, page: nextPage, datasetKey }))
  }

  function setPageSize(nextPageSize: PageSize) {
    setState({ page: 1, pageSize: nextPageSize, datasetKey })
  }

  function resetPage() {
    setState(current => ({ ...current, page: 1, datasetKey }))
  }

  return {
    page: currentPage,
    pageCount,
    pageSize,
    setPage,
    setPageSize,
    resetPage,
    startIndex,
    visibleRows,
    totalRecords: rows.length,
  }
}
