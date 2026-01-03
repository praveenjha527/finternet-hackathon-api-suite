import { WagmiProvider, createConfig } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConnectKitProvider, getDefaultConfig } from 'connectkit';
import { mainnet, sepolia } from 'wagmi/chains';

// Get WalletConnect project ID from environment
// IMPORTANT: WalletConnect REQUIRES a valid project ID to work
// Get your project ID from https://cloud.walletconnect.com (free account)
const walletConnectProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || import.meta.env.VITE_REOWN_PROJECT_ID;

if (!walletConnectProjectId) {
  console.warn(
    '⚠️ WalletConnect Project ID not found!\n' +
    'WalletConnect wallets will NOT work without a valid project ID.\n' +
    'Get your free project ID from: https://cloud.walletconnect.com\n' +
    'Then add it to your .env file: VITE_WALLETCONNECT_PROJECT_ID=your_project_id'
  );
}

// Configure wagmi with ConnectKit
const configParameters = getDefaultConfig({
  appName: 'Finternet Payment Gateway',
  appDescription: 'Trustless payment infrastructure',
  appUrl: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173',
  appIcon: typeof window !== 'undefined' ? `${window.location.origin}/assets/finternet_logo.svg` : '/assets/finternet_logo.svg',
  chains: [sepolia, mainnet],
  walletConnectProjectId: walletConnectProjectId, // Will be undefined if not set, which will disable WalletConnect
});

const config = createConfig(configParameters);

const queryClient = new QueryClient();

export function WalletProvider({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ConnectKitProvider>
          {children}
        </ConnectKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

