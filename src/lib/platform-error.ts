/**
 * council-platform structured-error decoding for the console.
 *
 * Kept dependency-free (no wallet/DOM imports) so it can be unit-tested and so
 * the `code` a council-platform error carries survives from the fetch layer all
 * the way to the operator-copy mapper (`friendlyError` in dom.ts).
 */

/**
 * Error carrying council-platform's machine-readable failure `code` alongside
 * the human `message`. The platform's error envelope is
 * `{ status, code, message, details }`; the console keys operator copy on
 * `code` and falls back to `message`. Thrown by `throwFromErrorResponse` so the
 * code survives to the view layer instead of being flattened to a bare
 * "Failed to X: 500" string.
 */
export class StructuredError extends Error {
  readonly code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "StructuredError";
    this.code = code;
  }
}

/** Parse a JSON body, returning undefined on failure rather than throwing. */
async function parseJsonBody(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Throw a `StructuredError` built from a failed response. Prefers the
 * platform's `body.message` over a bare HTTP status, and carries `body.code` so
 * the console can map a machine-readable identity to operator copy. Used by
 * every wrapper so errors don't reach the operator as "Failed to X: 503" when
 * the platform sent a real, structured explanation.
 */
export async function throwFromErrorResponse(
  res: Response,
  fallbackPrefix: string,
): Promise<never> {
  const body = await parseJsonBody(res);
  const message = isObject(body) && typeof body.message === "string"
    ? body.message
    : `${fallbackPrefix}: ${res.status}`;
  const code = isObject(body) && typeof body.code === "string"
    ? body.code
    : undefined;
  throw new StructuredError(message, code);
}
