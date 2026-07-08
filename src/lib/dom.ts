/**
 * Safe DOM helpers to avoid innerHTML XSS.
 */

export function renderError(
  container: HTMLElement,
  title: string,
  message: string,
): void {
  container.textContent = "";
  const h2 = document.createElement("h2");
  h2.textContent = title;
  const p = document.createElement("p");
  p.className = "error-text";
  p.textContent = message;
  container.append(h2, p);
}

export function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

export function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/**
 * council-platform `StructuredError.code` → operator-facing copy. The platform
 * emits a machine-readable `code` (see `StructuredError` in platform.ts); this
 * is the single mapping the console owns. moonlight-sdk 0.11.1 does NOT export
 * the platform's code catalog, so these codes are tracked locally and kept in
 * sync with council-platform's error classes. Codes whose server `message` is
 * already specific and safe (validation, not-found, conflicts) are intentionally
 * omitted so their message passes through verbatim.
 */
const CODE_COPY: Record<string, string> = {
  // Sign-in (challenge / signature) — @service/auth
  COUNCIL_AUTH_001:
    "Too many sign-in attempts. Please wait a moment and try again.",
  COUNCIL_AUTH_002: "Your sign-in request expired. Please start again.",
  COUNCIL_AUTH_003: "Your sign-in request expired. Please start again.",
  COUNCIL_AUTH_004:
    "The wallet you signed with doesn't match the one that started sign-in.",
  COUNCIL_AUTH_005:
    "We couldn't verify your signature. Please try signing in again.",
  // Session / JWT — @http/middleware/auth
  HTTP_AUTH_001: "Your session is invalid. Please sign in again.",
  HTTP_AUTH_002: "Your session is invalid. Please sign in again.",
  HTTP_AUTH_003: "Your session expired. Please sign in again.",
  HTTP_AUTH_004: "Your session is invalid. Please sign in again.",
  // Governance
  HTTP_COUNCIL_002: "That council could not be found.",
  CHANNEL_001:
    "The network is temporarily unavailable. Please try again shortly.",
  // Unexpected server-side failures
  GEN_000: "Something went wrong on the server. Please try again.",
  GEN_001: "Something went wrong on the server. Please try again.",
};

/** Pull a StructuredError-style `code` off any thrown value, if present. */
function errorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
  }
  return undefined;
}

/**
 * A server message is safe to show verbatim only if it reads like a human
 * sentence — not a stack frame, identifier dump, or transport error.
 */
function isSafeSentence(msg: string): boolean {
  return (
    msg.length > 10 && msg.length < 200 && /^[A-Z]/.test(msg) &&
    msg.includes(" ") && !/\d+\.\d+\.\d+/.test(msg) &&
    !/\b[A-Z]{4,}\b/.test(msg) && !msg.includes("_") &&
    !msg.includes("ECONN") && !msg.includes("ENOENT")
  );
}

/**
 * Map any thrown value to operator-facing copy. Order:
 *   1. a StructuredError `code` we curate → mapped copy;
 *   2. codeless client-side errors (wallet cancel / session / network) → copy;
 *   3. a safe, human-readable server `message` → shown verbatim;
 *   4. otherwise a generic fallback (and the raw detail is logged).
 * This replaces the old string-matching-only version — the primary key is now
 * the machine-readable code, so copy no longer depends on brittle text matches.
 */
export function friendlyError(error: unknown): string {
  const code = errorCode(error);
  if (code && code in CODE_COPY) return CODE_COPY[code];

  const msg = error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null && "message" in error
    ? String((error as { message: unknown }).message)
    : String(error);
  const lower = msg.toLowerCase();

  if (
    lower.includes("cancel") || lower.includes("rejected") ||
    lower.includes("denied") || lower.includes("user refused")
  ) {
    return "Transaction cancelled.";
  }
  if (
    lower.includes("not authenticated") || lower.includes("session expired")
  ) {
    return "Session expired. Please sign in again.";
  }
  if (lower.includes("failed to fetch") || lower.includes("networkerror")) {
    return "Network error. Please check your connection.";
  }
  if (
    lower.includes("insufficient") || lower.includes("underfunded") ||
    lower.includes("balance") || lower.includes("tx_insufficient")
  ) {
    return "Your wallet doesn't have enough funds to complete this transaction.";
  }

  // Unknown/missing code: show the server message only if it's a safe, human
  // sentence (e.g. "Channel not found"); otherwise a generic fallback.
  if (isSafeSentence(msg)) return msg;
  console.warn("[friendlyError]", msg);
  return "Something went wrong. Please try again.";
}
