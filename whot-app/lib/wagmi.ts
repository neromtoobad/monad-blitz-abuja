import { createConfig, http } from "wagmi";
import { coinbaseWallet, injected, walletConnect } from "wagmi/connectors";
import { RPC_URL, monadTestnet } from "./chain";

/**
 * WalletConnect needs a free project id from cloud.reown.com. Without one the
 * app still works with browser extensions and in-app wallet browsers, so it is
 * optional rather than required.
 */
const wcProjectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID?.trim();

export const config = createConfig({
  chains: [monadTestnet],
  connectors: [
    // Generic fallback. EIP-6963 discovery adds each installed wallet as its
    // own named connector on top of this, which is why the UI dedupes.
    injected({ shimDisconnect: true }),
    coinbaseWallet({ appName: "Whot Onchain", preference: "all" }),
    ...(wcProjectId
      ? [
          walletConnect({
            projectId: wcProjectId,
            showQrModal: true,
            metadata: {
              name: "Whot Onchain",
              description: "Nigerian Whot, fully onchain on Monad",
              url: "https://whot-app.vercel.app",
              icons: ["https://whot-app.vercel.app/whot/back.png"],
            },
          }),
        ]
      : []),
  ],
  // Leave EIP-6963 discovery on so installed wallets appear by name.
  multiInjectedProviderDiscovery: true,
  transports: {
    [monadTestnet.id]: http(RPC_URL),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
