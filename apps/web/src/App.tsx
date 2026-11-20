import { useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createConfig, http, WagmiProvider } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { loadConfig, type AppConfig } from './config';
import { aevumTestnet } from './lib/chain';
import { createProvider, type VaultDataProvider } from './lib/provider';
import { ConnectButton } from './components/ConnectButton';
import { NetworkBanner } from './components/NetworkBanner';
import { Overview } from './components/Overview';
import { DepositWithdraw } from './components/DepositWithdraw';
import { Sessions } from './components/Sessions';
import { Activity } from './components/Activity';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 10_000 } },
});

type Tab = 'overview' | 'deposit' | 'sessions' | 'activity';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'deposit', label: 'Deposit / Withdraw' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'activity', label: 'Activity' },
];

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [tab, setTab] = useState<Tab>('overview');

  useEffect(() => {
    let cancelled = false;
    void loadConfig().then((c) => {
      if (!cancelled) setConfig(c);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // wagmi config follows the loaded config (RPC URL comes from
  // deployments.json / env, with the public testnet RPC as default).
  const wagmiConfig = useMemo(
    () =>
      config
        ? createConfig({
            chains: [aevumTestnet],
            transports: { [aevumTestnet.id]: http(config.rpcUrl) },
            connectors: [injected()],
          })
        : null,
    [config],
  );

  const provider: VaultDataProvider | null = useMemo(
    () => (config ? createProvider(config) : null),
    [config],
  );

  if (!config || !wagmiConfig || !provider) {
    return (
      <div className="app-shell">
        <main className="loading-screen">
          <div className="logo-mark">A</div>
          <p className="muted">Loading AgentPay…</p>
        </main>
      </div>
    );
  }

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <div className="app-shell">
          <header className="app-header">
            <div className="brand">
              <span className="logo-mark">A</span>
              <div>
                <h1>AgentPay</h1>
                <p className="brand-sub">Autonomous bill payments on Aevum Testnet</p>
              </div>
            </div>
            <ConnectButton />
          </header>

          {config.mode === 'mock' && (
            <div className="banner banner-demo" role="status">
              <strong>Demo data — contracts not deployed yet.</strong> Everything
              below is sample data so the dashboard can be reviewed now. Point the
              app at the deployed vault (see README) to go live — no code changes
              needed.
            </div>
          )}

          <NetworkBanner />

          <nav className="tab-nav" aria-label="Dashboard sections">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={tab === t.id ? 'active' : ''}
                aria-current={tab === t.id ? 'page' : undefined}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <main>
            {tab === 'overview' && (
              <Overview config={config} provider={provider} onNavigate={setTab} />
            )}
            {tab === 'deposit' && <DepositWithdraw config={config} provider={provider} />}
            {tab === 'sessions' && <Sessions config={config} provider={provider} />}
            {tab === 'activity' && <Activity config={config} provider={provider} />}
          </main>

          <footer className="app-footer">
            <span>
              {config.mode === 'live'
                ? `Live on Aevum Testnet · vault ${config.vaultAddress.slice(0, 10)}… (source: ${config.source})`
                : 'Demo mode · no contracts configured'}
            </span>
            <a href={config.explorerUrl} target="_blank" rel="noreferrer">
              Explorer ↗
            </a>
            <a href="https://faucet.qday.info" target="_blank" rel="noreferrer">
              Testnet faucet ↗
            </a>
          </footer>
        </div>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
