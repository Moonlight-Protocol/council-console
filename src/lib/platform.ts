/**
 * API client for the council-platform backend.
 * Handles challenge-response auth and all admin API calls.
 */
import { PLATFORM_URL } from "./config.ts";
import { signMessage, getConnectedAddress } from "./wallet.ts";

const TOKEN_KEY = "council_platform_jwt";

// Persist token in localStorage so it survives page refreshes.
// The user authenticates once (signMessage) and stays authenticated
// until logout or token expiry.
let authToken: string | null = localStorage.getItem(TOKEN_KEY);

/**
 * Authenticate with council-platform via challenge-response.
 * The wallet signs the nonce (SEP-53), platform verifies and returns a JWT.
 */
export async function authenticate(): Promise<string> {
  const publicKey = getConnectedAddress();
  if (!publicKey) throw new Error("Wallet not connected");
  if (!PLATFORM_URL) throw new Error("Platform URL not configured");

  // Step 1: Request challenge nonce
  const challengeRes = await fetch(`${PLATFORM_URL}/api/v1/admin/auth/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publicKey }),
  });
  if (!challengeRes.ok) {
    throw new Error(`Failed to get auth challenge: ${challengeRes.status}`);
  }
  const { data: { nonce } } = await challengeRes.json();

  // Step 2: Sign nonce with wallet (SEP-53 format)
  const signature = await signMessage(nonce);

  // Step 3: Verify signature, receive JWT
  const verifyRes = await fetch(`${PLATFORM_URL}/api/v1/admin/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nonce, signature, publicKey }),
  });
  if (!verifyRes.ok) {
    throw new Error("Platform authentication failed");
  }
  const { data: { token } } = await verifyRes.json();

  authToken = token;
  localStorage.setItem(TOKEN_KEY, token);
  return token;
}

/**
 * Authenticated fetch wrapper. Auto-authenticates if no token,
 * retries once on 401 (token expired).
 */
async function platformFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  if (!authToken) throw new Error("Not authenticated. Please sign in first.");

  const doFetch = () =>
    fetch(`${PLATFORM_URL}${path}`, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${authToken}`,
        ...(opts.headers as Record<string, string> ?? {}),
      },
    });

  const res = await doFetch();
  if (res.status === 401) {
    clearPlatformAuth();
    // Redirect to login — JWT is invalid, user needs to sign in again
    window.location.hash = "#/login";
    throw new Error("Session expired");
  }
  return res;
}

/** Push council metadata to the platform. */
export async function pushMetadata(data: {
  name: string;
  description?: string;
  contactEmail?: string;
}): Promise<void> {
  const res = await platformFetch("/api/v1/council/metadata", {
    method: "PUT",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    throw new Error(`Failed to push metadata: ${res.status}`);
  }
}

/** Add a jurisdiction to the platform. Ignores 409 (already exists). */
export async function addJurisdiction(countryCode: string, label?: string): Promise<void> {
  const res = await platformFetch("/api/v1/council/jurisdictions", {
    method: "POST",
    body: JSON.stringify({ countryCode, label }),
  });
  if (!res.ok && res.status !== 409) {
    throw new Error(`Failed to add jurisdiction ${countryCode}: ${res.status}`);
  }
}

/** Register a channel with the platform. Ignores 409 (already exists). */
export async function registerChannel(data: {
  channelContractId: string;
  assetCode: string;
  assetContractId?: string;
  label?: string;
}): Promise<void> {
  const res = await platformFetch("/api/v1/council/channels", {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!res.ok && res.status !== 409) {
    throw new Error(`Failed to register channel: ${res.status}`);
  }
}

/** Delete the council and all related data from the platform. */
export async function deleteCouncil(): Promise<void> {
  const res = await platformFetch("/api/v1/council/metadata", { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete council");
}

// --- Channel API ---

export interface PlatformChannel {
  id: string;
  channelContractId: string;
  assetCode: string;
  assetContractId: string | null;
  label: string | null;
}

/** Disable a channel (soft-delete). */
export async function disableChannel(id: string): Promise<void> {
  const res = await platformFetch(`/api/v1/council/channels/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to disable channel");
}

/** Re-enable a disabled channel. */
export async function enableChannel(id: string): Promise<void> {
  const res = await platformFetch(`/api/v1/council/channels/${encodeURIComponent(id)}/enable`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to re-enable channel");
}

/** List active channels. */
export async function listChannels(): Promise<PlatformChannel[]> {
  const res = await platformFetch("/api/v1/council/channels");
  if (!res.ok) throw new Error("Failed to fetch channels");
  const { data } = await res.json();
  return data;
}

/** List disabled channels. */
export async function listDisabledChannels(): Promise<PlatformChannel[]> {
  const res = await platformFetch("/api/v1/council/channels/disabled");
  if (!res.ok) throw new Error("Failed to fetch disabled channels");
  const { data } = await res.json();
  return data;
}

// --- Join request API ---

export interface JoinRequest {
  id: string;
  publicKey: string;
  label: string | null;
  contactEmail: string | null;
  status: string;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
}

/** Fetch join requests (admin). */
export async function listJoinRequests(status?: string): Promise<JoinRequest[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  const res = await platformFetch(`/api/v1/council/provider-requests${qs}`);
  if (!res.ok) throw new Error("Failed to fetch join requests");
  const { data } = await res.json();
  return data;
}

/** Approve a join request (admin). */
export async function approveJoinRequest(id: string): Promise<void> {
  const res = await platformFetch(`/api/v1/council/provider-requests/${encodeURIComponent(id)}/approve`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Failed to approve join request");
}

/** Reject a join request (admin). */
export async function rejectJoinRequest(id: string): Promise<void> {
  const res = await platformFetch(`/api/v1/council/provider-requests/${encodeURIComponent(id)}/reject`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Failed to reject join request");
}

/** Submit a join request (public, no auth). */
export async function submitJoinRequest(data: {
  publicKey: string;
  label?: string;
  contactEmail?: string;
}): Promise<void> {
  if (!PLATFORM_URL) throw new Error("Platform URL not configured");
  const res = await fetch(`${PLATFORM_URL}/api/v1/public/provider/join-request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (res.status === 409) throw new Error("A pending request already exists for this key");
  if (!res.ok) throw new Error("Failed to submit join request");
}

/** Check if the platform URL is configured. */
export function isPlatformConfigured(): boolean {
  return !!PLATFORM_URL;
}

/** Check if we have a valid (non-expired) auth token. */
export function isAuthenticated(): boolean {
  if (!authToken) return false;
  try {
    const payload = JSON.parse(atob(authToken.split(".")[1]));
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      clearPlatformAuth();
      return false;
    }
  } catch {
    clearPlatformAuth();
    return false;
  }
  return true;
}

/** Clear cached auth token (e.g. on logout). */
export function clearPlatformAuth(): void {
  authToken = null;
  localStorage.removeItem(TOKEN_KEY);
}
