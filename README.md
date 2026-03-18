# Council Console

Web console for Moonlight Protocol council administrators. Deploy contracts, manage Privacy Providers, and monitor your council.

## What it does

- **Deploy contracts**: Deploy Channel Auth + Privacy Channel contract pairs from soroban-core GitHub releases
- **Manage providers**: Add and remove Privacy Providers on a Channel Auth contract
- **Track councils**: Local persistence of deployed contract IDs and provider membership
- **Wallet auth**: Connect via Freighter, LOBSTR, xBull, or WalletConnect. All transactions signed by the wallet.

## Development

```bash
# Install dependencies
deno install

# Build the app bundle
deno task build

# Start dev server (port 3020, watches for changes)
deno task dev

# Run integration tests (requires local-dev/up.sh running)
deno task test
```

## Testing

Integration tests run against local infrastructure (Stellar standalone network via `local-dev/up.sh`):

```bash
# Start local infra first
cd ~/repos/local-dev && ./up.sh

# Run tests
cd ~/repos/council-console && deno task test
```

The test deploys Channel Auth + Privacy Channel contracts, adds a provider, verifies it, and removes it.

## Deployment

Static files are deployed to a public [Tigris](https://www.tigrisdata.com/) bucket on Fly.io.

- **Bucket**: `moonlight-council-console`
- **URL**: https://moonlight-council-console.fly.storage.tigris.dev/index.html
- **Auto-deploy**: push to `main` triggers the GitHub Actions workflow (`.github/workflows/deploy.yml`)
- **Secrets** (set in GitHub repo settings): `TIGRIS_ACCESS_KEY_ID`, `TIGRIS_SECRET_ACCESS_KEY`

Pipeline:

1. Push to `main` triggers `auto-version.yml` (bumps version in `deno.json`, creates git tag)
2. Tag push (`v*`) triggers `deploy.yml` (builds production bundle, deploys to Tigris)

Auto-version uses conventional commits to determine the bump type:
- `feat:` or `feat(...):` merges bump the **minor** version
- `feat!:` or `BREAKING CHANGE` bumps **major**
- Everything else bumps **patch**

The workflow skips commits starting with `chore: bump version` to prevent re-triggering itself. It uses a PAT (`AUTO_VERSION_TOKEN`) to bypass branch protection for the version bump commit.

### Manual deploy

```bash
deno task build -- --production
aws s3 sync public/ s3://moonlight-council-console/ \
  --endpoint-url https://fly.storage.tigris.dev \
  --acl public-read --delete
```

## Architecture

Static SPA (no backend). Contract interactions go directly to Stellar RPC. Council state is stored in the browser's localStorage since no reverse lookup exists on-chain.

```
Browser
  ├── Wallet (Freighter) ── signs transactions
  ├── Stellar RPC ── deploys contracts, invokes functions
  ├── GitHub API ── fetches WASM binaries from soroban-core releases
  ├── PostHog ── UI analytics (production only)
  └── Grafana OTLP ── operation traces (production only)
```

## GitHub Secrets

Required for CI deploys:

| Secret | Purpose |
|--------|---------|
| `TIGRIS_ACCESS_KEY_ID` | Tigris CDN upload |
| `TIGRIS_SECRET_ACCESS_KEY` | Tigris CDN upload |
| `POSTHOG_PROJECT_TOKEN` | PostHog analytics |
| `GRAFANA_OTLP_ENDPOINT` | OTEL trace export endpoint |
| `GRAFANA_OTLP_AUTH` | OTEL basic auth header |
