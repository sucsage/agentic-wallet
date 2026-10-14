import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
        settings: { optimizer: { enabled: true, runs: 200 } },
      },
    },
  },
  networks: {
    // Mine failing transactions as reverted (like a real chain) instead of throwing,
    // so the local attack demo produces a reverted tx hash.
    node: {
      type: "edr-simulated",
      chainType: "l1",
      throwOnTransactionFailures: false,
    },
    localhost: {
      type: "http",
      chainType: "l1",
      url: "http://127.0.0.1:8545",
    },
    // Private Besu chain (../chain), gas is free. Local: loopback RPC. Chain server: its public
    // URL in BESU_RPC_URL, which needs the bearer JWT in CHAIN_TOKEN.
    besu: {
      type: "http",
      chainType: "l1",
      url: process.env.BESU_RPC_URL ?? "http://127.0.0.1:8555",
      httpHeaders: process.env.CHAIN_TOKEN ? { authorization: `Bearer ${process.env.CHAIN_TOKEN.trim()}` } : {},
      accounts: [configVariable("DEPLOYER_PRIVATE_KEY")],
    },
    baseSepolia: {
      type: "http",
      chainType: "op",
      url: configVariable("BASE_SEPOLIA_RPC_URL"),
      accounts: [configVariable("DEPLOYER_PRIVATE_KEY")],
    },
  },
});
