export interface SanitizedErrorBody {
  statusCode: number;
  message: string;
  timestamp: string;
  path: string;
}

/**
 * Builds a client-safe error body: no stack trace, no internal error
 * message details beyond what's safe to show. Shared by AllExceptionsFilter
 * so every error response (regardless of exception type) has the same
 * shape.
 */
export function buildSanitizedErrorBody(
  statusCode: number,
  message: string,
  path: string,
): SanitizedErrorBody {
  return {
    statusCode,
    message,
    timestamp: new Date().toISOString(),
    path,
  };
}
