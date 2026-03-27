/**
 * Local persistence for managed councils and contracts.
 * No reverse lookup exists on-chain, so the console tracks
 * which contracts this admin deployed/manages.
 */

export interface ManagedCouncil {
  channelAuthId: string;
  privacyChannelId?: string;
  assetCode: string;
  assetIssuer?: string;
  adminAddress: string;
  providers: string[];
  createdAt: string;
  label?: string;
  jurisdictions?: string[];
  contactEmail?: string;
  description?: string;
  channels?: Array<{
    contractId: string;
    assetCode: string;
    assetIssuer?: string;
    assetContractId?: string;
  }>;
}

const STORE_KEY = "council_console_councils";

export function loadCouncils(): ManagedCouncil[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveCouncils(councils: ManagedCouncil[]): void {
  localStorage.setItem(STORE_KEY, JSON.stringify(councils));
}

export function addCouncil(council: ManagedCouncil): void {
  const councils = loadCouncils();
  if (councils.some((c) => c.channelAuthId === council.channelAuthId)) return;
  councils.push(council);
  saveCouncils(councils);
}

export function updateCouncil(channelAuthId: string, update: Partial<ManagedCouncil>): void {
  const councils = loadCouncils();
  const idx = councils.findIndex((c) => c.channelAuthId === channelAuthId);
  if (idx === -1) return;
  councils[idx] = { ...councils[idx], ...update };
  saveCouncils(councils);
}

export function removeCouncil(channelAuthId: string): void {
  const councils = loadCouncils().filter((c) => c.channelAuthId !== channelAuthId);
  saveCouncils(councils);
}

export function getCouncil(channelAuthId: string): ManagedCouncil | undefined {
  return loadCouncils().find((c) => c.channelAuthId === channelAuthId);
}
