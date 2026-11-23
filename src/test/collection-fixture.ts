import { createEmptyData } from '@/data/fixtures/empty'
import { prototypeReducer } from '@/app/state/prototype-reducer'
import { prepareMoveInPayment } from '@/domain/calculations/move-in'

export function overdueWorkspace() {
  let data = createEmptyData('2026-11-23')
  data.rooms = data.rooms.map(room => room.id === 'room-2' ? { ...room, washingMachineEnabled: false } : room)
  data = prototypeReducer(data, { type: 'tenant/created', asOf: '2026-11-23', draft: {
    name: 'Historical Tenant', email: 'history@example.com', phone: '', address: '', notes: '', roomId: 'room-2', moveInDate: '2026-07-06',
  } })
  const result = prepareMoveInPayment(data, { obligationId: data.moveInObligations[0]!.id, categories: ['ADVANCE', 'SECURITY_DEPOSIT'], paidOn: '2026-07-06' })
  if (!result.ok) throw new Error(result.reason)
  return result.data
}
