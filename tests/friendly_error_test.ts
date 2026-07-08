import { assertEquals } from "@std/assert";
import { friendlyError } from "../src/lib/dom.ts";
import { StructuredError } from "../src/lib/platform-error.ts";

// 1. A curated code maps to operator copy, regardless of the raw server message.
Deno.test("friendlyError - maps a known code to curated copy", () => {
  const err = new StructuredError("Invalid signature", "COUNCIL_AUTH_005");
  assertEquals(
    friendlyError(err),
    "We couldn't verify your signature. Please try signing in again.",
  );
});

Deno.test("friendlyError - maps session/JWT codes to sign-in copy", () => {
  assertEquals(
    friendlyError(new StructuredError("Expired token", "HTTP_AUTH_003")),
    "Your session expired. Please sign in again.",
  );
});

Deno.test("friendlyError - maps a generic server failure code", () => {
  assertEquals(
    friendlyError(new StructuredError("Internal server error.", "GEN_001")),
    "Something went wrong on the server. Please try again.",
  );
});

// 2. An unknown code with a safe server message shows the message verbatim.
Deno.test("friendlyError - passes through a safe server message for an unmapped code", () => {
  const err = new StructuredError("Channel not found", "HTTP_REQ_004");
  assertEquals(friendlyError(err), "Channel not found");
});

Deno.test("friendlyError - passes through a conflict message verbatim", () => {
  const err = new StructuredError(
    "Channel with this contract ID already exists",
    "HTTP_REQ_005",
  );
  assertEquals(
    friendlyError(err),
    "Channel with this contract ID already exists",
  );
});

// 3. Codeless client-side errors fall back to heuristics.
Deno.test("friendlyError - wallet cancellation heuristic (no code)", () => {
  assertEquals(
    friendlyError(new Error("User refused the request")),
    "Transaction cancelled.",
  );
});

Deno.test("friendlyError - session heuristic (no code)", () => {
  assertEquals(
    friendlyError(new Error("Session expired")),
    "Session expired. Please sign in again.",
  );
});

Deno.test("friendlyError - network heuristic (no code)", () => {
  assertEquals(
    friendlyError(new TypeError("Failed to fetch")),
    "Network error. Please check your connection.",
  );
});

// 4. Unknown code + unsafe/raw message → generic fallback (not leaked verbatim).
Deno.test("friendlyError - unsafe message with no code falls back to generic", () => {
  assertEquals(
    friendlyError(new Error("ECONN_REFUSED at 127.0.0.1:5432")),
    "Something went wrong. Please try again.",
  );
});

Deno.test("friendlyError - lowercase identifier-ish message falls back to generic", () => {
  // Starts lowercase / not a human sentence → not shown verbatim.
  assertEquals(
    friendlyError(
      new StructuredError(
        "councilId query parameter is required",
        "HTTP_COUNCIL_001",
      ),
    ),
    "Something went wrong. Please try again.",
  );
});
