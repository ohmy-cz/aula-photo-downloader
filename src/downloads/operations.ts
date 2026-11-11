import type { ProcessResult, Run } from '../types'
import { AppError } from '../errors'

/** Retain only the current/latest result, so repeated polls never double-count a completed file. */
export const operationStatus = (run: Run): ProcessResult => {
  const operation = run.operation

  if (!operation) {
    throw new AppError('file-retry')
  }

  if (operation.error) {
    throw new AppError(operation.error)
  }

  if (operation.result) {
    return { mode: operation.result }
  }

  return {
    mode: 'working',
    operation: { runId: run.id, jobId: operation.jobId },
  }
}
