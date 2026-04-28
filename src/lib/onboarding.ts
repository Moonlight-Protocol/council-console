/**
 * Onboarding step definitions.
 * Step completion is derived from the council-platform state, not stored locally.
 */
import { PLATFORM_URL } from "./config.ts";
import { getConnectedAddress } from "./wallet.ts";
import { currentTraceparent } from "./tracer.ts";

export const ONBOARDING_STEPS = [
  { id: "metadata", label: "Council" },
  { id: "create", label: "Council" },
  { id: "fund", label: "Treasury" },
  { id: "assets", label: "Assets" },
  { id: "invite", label: "Providers" },
] as const;

export type OnboardingStepId = typeof ONBOARDING_STEPS[number]["id"];

export interface CouncilState {
  exists: boolean;
  name?: string;
  description?: string;
  contactEmail?: string;
  channelAuthId?: string;
  councilPublicKey?: string;
  channels: Array<{ channelContractId: string; assetCode: string }>;
  jurisdictions: Array<{ countryCode: string }>;
  providers: Array<{ publicKey: string; label?: string }>;
}

/** Fetch a council's state from the platform. */
export async function fetchCouncilState(
  councilId?: string,
): Promise<CouncilState> {
  if (!PLATFORM_URL) {
    return { exists: false, channels: [], jurisdictions: [], providers: [] };
  }

  try {
    const qs = councilId ? `?councilId=${encodeURIComponent(councilId)}` : "";
    const tp = currentTraceparent();
    const res = await fetch(
      `${PLATFORM_URL}/api/v1/public/council${qs}`,
      tp ? { headers: { traceparent: tp } } : undefined,
    );
    if (!res.ok) {
      return { exists: false, channels: [], jurisdictions: [], providers: [] };
    }
    const { data } = await res.json();
    return {
      exists: !!data.council,
      name: data.council?.name,
      description: data.council?.description,
      contactEmail: data.council?.contactEmail,
      channelAuthId: data.council?.channelAuthId,
      councilPublicKey: data.council?.councilPublicKey,
      channels: data.channels ?? [],
      jurisdictions: data.jurisdictions ?? [],
      providers: data.providers ?? [],
    };
  } catch {
    return { exists: false, channels: [], jurisdictions: [], providers: [] };
  }
}

/** Determine the first incomplete onboarding step from platform state. */
export function getNextStep(state: CouncilState): OnboardingStepId | null {
  if (!state.exists) return "metadata";
  // Council exists → metadata + fund + create are done
  // Check if they've gone through assets step (at least viewed it)
  // Assets and invite are always accessible, but for onboarding
  // we consider them "done" once the council exists and has been set up
  return null;
}

/** Check if the connected wallet owns this council. */
export function isCouncilAdmin(state: CouncilState): boolean {
  const address = getConnectedAddress();
  if (!address || !state.councilPublicKey) return false;
  return state.councilPublicKey === address;
}

/** Save form data mid-entry so it survives a refresh within the same session. */
export function saveFormDraft(
  step: string,
  data: Record<string, unknown>,
): void {
  sessionStorage.setItem(`onboarding_draft_${step}`, JSON.stringify(data));
}

/** Retrieve saved form draft. */
export function getFormDraft(step: string): Record<string, unknown> | null {
  try {
    const raw = sessionStorage.getItem(`onboarding_draft_${step}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearFormDraft(step: string): void {
  sessionStorage.removeItem(`onboarding_draft_${step}`);
}
