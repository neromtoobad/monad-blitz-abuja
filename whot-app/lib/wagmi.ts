import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { RPC_URL, monadTestnet } from "./chain";

export const config = createConfig({
  chains: [monadTestnet],
  connectors: [injected()],
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
