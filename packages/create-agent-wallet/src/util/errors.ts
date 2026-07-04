export class CawError extends Error {
  constructor(
    message: string,
    public readonly code: number
  ) {
    super(message)
    this.name = 'CawError'
  }
}

export const ExitCodes = {
  OK: 0,
  GENERIC: 1,
  INVALID_ARGS: 2,
  NETWORK: 3,
  ACTIVITY_NOT_FOUND: 4,
  DIR_EXISTS: 5,
  SESSION_FAILED: 6,
  SCHEMA: 7
} as const

export type ExitCode = (typeof ExitCodes)[keyof typeof ExitCodes]
