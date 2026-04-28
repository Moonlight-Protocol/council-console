/**
 * Console configuration.
 * Reads from global config object set in index.html or defaults.
 */
declare global {
  interface Window {
    __CONSOLE_CONFIG__?: {
      environment?: string;
      stellarNetwork?: "testnet" | "mainnet" | "standalone";
      rpcUrl?: string;
      horizonUrl?: string;
      friendbotUrl?: string;
      platformUrl?: string;
      posthogKey?: string;
      posthogHost?: string;
      otelEndpoint?: string;
      otelAuth?: string;
      allowlist?: string[];
    };
  }
}

const config = window.__CONSOLE_CONFIG__ ?? {};

export const ENVIRONMENT = config.environment ?? "development";
export const IS_PRODUCTION = ENVIRONMENT === "production";
export const STELLAR_NETWORK = config.stellarNetwork ?? "testnet";
export const RPC_URL = config.rpcUrl ?? "https://soroban-testnet.stellar.org";
export const HORIZON_URL = config.horizonUrl ?? "https://horizon-testnet.stellar.org";
export const FRIENDBOT_URL = config.friendbotUrl ?? "https://friendbot.stellar.org";
export const POSTHOG_KEY = config.posthogKey ?? "";
export const POSTHOG_HOST = config.posthogHost ?? "https://us.i.posthog.com";
export const PLATFORM_URL = config.platformUrl ?? "";
export const OTEL_ENDPOINT = config.otelEndpoint ?? "";
export const OTEL_AUTH = config.otelAuth ?? "";

export function isAllowed(address: string): boolean {
  const list = config.allowlist ?? [];
  return list.includes("*") || list.includes(address);
}

export function getNetworkPassphrase(): string {
  switch (STELLAR_NETWORK) {
    case "mainnet": return "Public Global Stellar Network ; September 2015";
    case "standalone": return "Standalone Network ; February 2017";
    default: return "Test SDF Network ; September 2015";
  }
}
