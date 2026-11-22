import { createContext } from 'react'
import { civilDateInTimeZone } from '@/lib/business-date'

export const ApplicationDateContext = createContext(civilDateInTimeZone())
