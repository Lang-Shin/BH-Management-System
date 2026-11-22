import { createContext } from 'react'
import { resolveOccupancyDate } from '@/data/fixtures/demo'

export const ApplicationDateContext = createContext(resolveOccupancyDate())
