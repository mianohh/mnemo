"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createNetworkConfig,
  SuiClientProvider,
  WalletProvider,
} from "@mysten/dapp-kit";
import "@mysten/dapp-kit/dist/index.css";

const { networkConfig } = createNetworkConfig({
  mainnet: {
    url: process.env.NEXT_PUBLIC_SUI_RPC_URL ?? "https://fullnode.mainnet.sui.io:443",
    network: "mainnet",
  },
});

export function WalletProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networkConfig} defaultNetwork="mainnet">
        <WalletProvider autoConnect theme={null}>
          {children}
        </WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  );
}
