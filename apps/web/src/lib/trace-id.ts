/**
 * Error messages carry the request's trace id as a trailing "[trace <32 hex>]", so it survives server actions
 * (which return plain strings) and the error toast can show it to search in the tracing backend.
 */
const MARK = /\s*\[trace ([0-9a-f]{32})\]$/;

/** `message` with the trace id appended; unchanged without one or when it already has one. */
export function withTrace(message: string, traceId: string | undefined): string {
  if (!traceId || MARK.test(message)) return message;
  return `${message} [trace ${traceId}]`;
}

/** The message without its trace id, and the trace id when it has one. */
export function splitTrace(message: string): { message: string; traceId?: string } {
  const m = MARK.exec(message);
  return m ? { message: message.slice(0, m.index), traceId: m[1] } : { message };
}
