import { handleRequest } from '@/server/router'
import type { WorkerEnv } from '@/server/env'

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return handleRequest(request, env)
  },
} satisfies ExportedHandler<WorkerEnv>
