export class HttpError extends Error {
  constructor(public status: number, message: string, public code = 'ERROR', public details?: unknown) {
    super(message);
  }
}
/** Thrown when the RPC node / chain cannot be reached. Mapped to HTTP 503. */
export class ChainUnavailableError extends HttpError {
  constructor(message = 'Blockchain node is temporarily unavailable', public cause?: unknown) {
    super(503, message, 'CHAIN_UNAVAILABLE');
  }
}
