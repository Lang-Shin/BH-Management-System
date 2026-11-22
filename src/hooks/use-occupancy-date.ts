import { useContext } from 'react'
import { ApplicationDateContext } from '@/app/providers/application-date-context'

export function useOccupancyDate() {
  return useContext(ApplicationDateContext)
}
