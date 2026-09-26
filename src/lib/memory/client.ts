import { MemWal } from "@mysten-incubation/memwal";

let client: MemWal | null = null;

export function memoryConfigured(): boolean {
  return Boolean(
    process.env.MEMWAL_PRIVATE_KEY && process.env.MEMWAL_ACCOUNT_ID
  );
}

export function getMemWal(): MemWal {
  if (!memoryConfigured()) {
    throw new Error(
      "Walrus Memory is not configured: set MEMWAL_PRIVATE_KEY and MEMWAL_ACCOUNT_ID (see .env.example)"
    );
  }
  if (!client) {
    client = MemWal.create({
      key: process.env.MEMWAL_PRIVATE_KEY!,
      accountId: process.env.MEMWAL_ACCOUNT_ID!,
      serverUrl:
        process.env.MEMWAL_SERVER_URL ?? "https://relayer.memory.walrus.xyz",
    });
  }
  return client;
}

export function memwalNetwork(): "mainnet" | "testnet" {
  const url = process.env.MEMWAL_SERVER_URL ?? "";
  if (url.includes("staging") || process.env.MEMWAL_NETWORK === "testnet") {
    return "testnet";
  }
  return "mainnet";
}
