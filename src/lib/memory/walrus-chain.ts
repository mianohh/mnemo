// Read-only view of the Walrus Blob objects our account owner holds on Sui.
//
// The relayer exposes no endpoint for "when does this blob expire", and the
// aggregator has no by-blob-id info route either — but every Blob object is a
// plain Sui object owned by the MemWal account's owner address, carrying
// `blob_id`, `storage.start_epoch` and `storage.end_epoch`. Sui's JSON-RPC on
// public fullnodes was sunset in July 2026, so we read them through GraphQL.
//
// Nothing here writes, signs or decrypts: it only turns "which blobs do we
// own" into "what is their object id and expiry epoch".

export interface OnChainBlob {
  /** Sui object id of the Blob — this is what `walrus extend` takes. */
  objectId: string;
  /** Blob id in the aggregator's base64url form (matches `blob_id` in the mirror). */
  blobId: string;
  startEpoch: number;
  endEpoch: number;
  size: number;
  deletable: boolean;
}

const DEFAULT_GRAPHQL_URL = "https://graphql.mainnet.sui.io/graphql";
// Struct ids keep the package they were *defined* in, so upgrades of the
// Walrus package do not change this prefix on mainnet.
const DEFAULT_BLOB_TYPE =
  "0xfdc88f7d7cf30afab2f82e8380d11ee8f70efb90e863d1de8616fae1bb09ea77::blob::Blob";

const QUERY_TIMEOUT_MS = 8_000;
const PAGE_SIZE = 50;
/** Owned-object lists are stable for a minute; dashboards and crons share it. */
const CACHE_TTL_MS = 60_000;

const globalScope = globalThis as unknown as {
  __mnemoBlobCache?: {
    blobs: OnChainBlob[];
    owner: string;
    at: number;
    /** True when the last refresh failed and these rows are from before it. */
    stale: boolean;
  };
  __mnemoEpochCache?: {
    value: ChainEpochState;
    at: number;
  };
};

function graphqlUrl(): string {
  return process.env.SUI_GRAPHQL_URL ?? DEFAULT_GRAPHQL_URL;
}

function blobType(): string {
  return process.env.WALRUS_BLOB_TYPE ?? DEFAULT_BLOB_TYPE;
}

/** On-chain u256 -> the base64url string the aggregator and SDK use. */
function decimalBlobIdToBase64Url(decimal: string): string {
  const hex = BigInt(decimal).toString(16).padStart(64, "0");
  return Buffer.from(hex, "hex").toString("base64url");
}

/**
 * Canonicalize a stored blob id to the aggregator's unpadded base64url form.
 * The same blob is written as a decimal u256 on chain, as base64url by the
 * aggregator/SDK, and as padded standard base64 by anything speaking plain
 * base64 — a mirror row in either of the latter two spells a blob the exact
 * match in `linkOnChainBlobs` will never see. Anything that is none of these
 * (a job id, a testnet id, a typo) is returned untouched so it still fails to
 * match rather than matching something else.
 */
export function normalizeBlobId(id: string): string {
  const trimmed = id.trim();
  if (/^\d{1,78}$/.test(trimmed)) return decimalBlobIdToBase64Url(trimmed);
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex").toString("base64url");
  }
  if (/^[0-9A-Za-z+/\-_]{40,44}={0,2}$/.test(trimmed)) {
    return Buffer.from(trimmed, "base64").toString("base64url");
  }
  return id;
}

async function gql<T>(
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const res = await fetch(graphqlUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Sui GraphQL HTTP ${res.status}`);
  const body = (await res.json()) as {
    data?: T;
    errors?: { message: string }[];
  };
  if (body.errors?.length) {
    throw new Error(`Sui GraphQL: ${body.errors[0].message}`);
  }
  if (!body.data) throw new Error("Sui GraphQL returned no data");
  return body.data;
}

/**
 * The MemWal account is shared (not address-owned), so its fields carry the
 * owner that the relayer transfers Blob objects to. Overridable for networks
 * where the account was provisioned differently.
 */
async function resolveOwner(accountId: string): Promise<string> {
  const override = process.env.MEMWAL_OWNER_ADDRESS;
  if (override) return override.toLowerCase();

  const data = await gql<{
    object: { asMoveObject: { contents: { json: { owner?: string } } } } | null;
  }>(
    `query($id: SuiAddress!) {
      object(address: $id) {
        asMoveObject { contents { json } }
      }
    }`,
    { id: accountId }
  );
  const owner = data.object?.asMoveObject?.contents?.json?.owner;
  if (typeof owner !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(owner)) {
    throw new Error("could not resolve the MemWal account owner on Sui");
  }
  return owner.toLowerCase();
}

/**
 * Every Blob object owned by `owner`, decoded. Throws on any transport or
 * schema problem — callers treat that as "no on-chain data right now" rather
 * than as an empty namespace.
 */
interface OwnedObjectsPage {
  address: {
    objects: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: {
        address: string;
        contents: { json: Record<string, unknown> };
      }[];
    };
  } | null;
}

export async function fetchOwnedBlobs(opts: {
  accountId: string;
  force?: boolean;
}): Promise<OnChainBlob[]> {
  const cache = globalScope.__mnemoBlobCache;
  if (!opts.force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.blobs;
  }

  try {
    const { owner, blobs } = await pullOwnedBlobs(opts.accountId);
    globalScope.__mnemoBlobCache = {
      blobs,
      owner,
      at: Date.now(),
      stale: false,
    };
    return blobs;
  } catch (e) {
    // A slow GraphQL answer must not blank out expiry data we already hold:
    // hand back the last known set and mark it stale so callers can say so.
    if (cache) {
      globalScope.__mnemoBlobCache = { ...cache, stale: true };
      return cache.blobs;
    }
    throw e;
  }
}

async function pullOwnedBlobs(
  accountId: string
): Promise<{ owner: string; blobs: OnChainBlob[] }> {
  const owner = await resolveOwner(accountId);
  const blobs: OnChainBlob[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < 40; page++) {
    const data: OwnedObjectsPage = await gql<OwnedObjectsPage>(
      `query($owner: SuiAddress!, $type: String!, $cursor: String) {
        address(address: $owner) {
          objects(first: ${PAGE_SIZE}, after: $cursor, filter: { type: $type }) {
            pageInfo { hasNextPage endCursor }
            nodes { address contents { json } }
          }
        }
      }`,
      { owner, type: blobType(), cursor }
    );

    const connection = data.address?.objects;
    if (!connection) break;
    for (const node of connection.nodes) {
      const json = node.contents.json;
      const storage = json.storage as
        | { start_epoch?: string | number; end_epoch?: string | number }
        | undefined;
      if (typeof json.blob_id !== "string" || !storage) continue;
      blobs.push({
        objectId: node.address,
        blobId: decimalBlobIdToBase64Url(json.blob_id),
        startEpoch: Number(storage.start_epoch ?? 0),
        endEpoch: Number(storage.end_epoch ?? 0),
        size: Number(json.size ?? 0),
        deletable: json.deletable === true,
      });
    }

    if (!connection.pageInfo.hasNextPage || !connection.pageInfo.endCursor) break;
    cursor = connection.pageInfo.endCursor;
  }

  return { owner, blobs };
}

/**
 * Owner address the relayer transfers Blob objects to, as resolved on chain.
 * Used to tell a renewer *whose* key can call `walrus extend`.
 */
export function cachedOwner(): string | null {
  return globalScope.__mnemoBlobCache?.owner ?? null;
}

/** True when the last chain refresh failed and the cache is from before it. */
export function isBlobCacheStale(): boolean {
  return globalScope.__mnemoBlobCache?.stale === true;
}

/**
 * The Walrus system object (shared, not owned). Its single dynamic field
 * carries the epoch state: `future_accounting.ring_buffer` holds one entry per
 * epoch with slots laid out as `epoch mod length`, and `current_index` points
 * at the entry of the epoch we are in — so reading slot `current_index` *is*
 * reading the current epoch. Overridable for networks provisioned elsewhere.
 */
const DEFAULT_SYSTEM_OBJECT =
  "0x2134d52768ea07e8c43570ef975eb3e4c27a39fa6396bef985b5abc58d03ddd2";
/** The epoch only moves twice a month; the anchor never moves at all. */
const EPOCH_CACHE_TTL_MS = 5 * 60_000;

export interface ChainEpochState {
  /** Current Walrus epoch, read from the system object. Exact, not estimated. */
  epoch: number;
  /** Wall-clock start of epoch 1 (the first event of the package), in ms. */
  epoch1StartMs: number;
}

function systemObject(): string {
  return process.env.WALRUS_SYSTEM_OBJECT ?? DEFAULT_SYSTEM_OBJECT;
}

/** `<package>` prefix, shared by every event the Walrus package emits. */
function packagePrefix(): string {
  const blobType = process.env.WALRUS_BLOB_TYPE ?? DEFAULT_BLOB_TYPE;
  return blobType.split("::")[0];
}

interface EpochStatePage {
  object: {
    asMoveObject: {
      dynamicFields: { nodes: { contents: { json: unknown } }[] };
    } | null;
  } | null;
  events: { nodes: { timestamp: string }[] };
}

function readCurrentEpoch(data: EpochStatePage): number {
  const nodes = data.object?.asMoveObject?.dynamicFields?.nodes ?? [];
  for (const node of nodes) {
    const json = node.contents.json as {
      future_accounting?: unknown;
      value?: { future_accounting?: unknown };
    };
    const accounting = (json.future_accounting ??
      json.value?.future_accounting) as
      | { current_index?: unknown; ring_buffer?: { epoch?: unknown }[] }
      | undefined;
    if (!accounting || !Array.isArray(accounting.ring_buffer)) continue;
    const slot = accounting.ring_buffer[Number(accounting.current_index)];
    const epoch = Number(slot?.epoch);
    if (Number.isInteger(epoch) && epoch > 0) return epoch;
  }
  throw new Error("could not read the Walrus epoch from the system object");
}

/**
 * The two facts expiry dates are built from, in one round trip: the epoch we
 * are in right now (system object) and when epoch 1 began (first event of the
 * package — the anchor dates are measured from). Throws on anything unexpected
 * so callers fall back to the mirror clock rather than print a number they
 * cannot stand behind.
 */
export async function fetchEpochState(): Promise<ChainEpochState> {
  const cache = globalScope.__mnemoEpochCache;
  if (cache && Date.now() - cache.at < EPOCH_CACHE_TTL_MS) return cache.value;

  const data = await gql<EpochStatePage>(
    `query($id: SuiAddress!, $module: String!) {
      object(address: $id) {
        asMoveObject {
          dynamicFields(first: 50) { nodes { contents { json } } }
        }
      }
      events(first: 1, filter: { module: $module }) { nodes { timestamp } }
    }`,
    { id: systemObject(), module: packagePrefix() }
  );

  const epoch = readCurrentEpoch(data);
  const raw = data.events.nodes[0]?.timestamp;
  if (!raw) throw new Error("could not read the first Walrus event");
  const epoch1StartMs = /^\d+$/.test(raw) ? Number(raw) : Date.parse(raw);
  if (!Number.isFinite(epoch1StartMs)) {
    throw new Error(`unexpected Walrus event timestamp: ${raw}`);
  }

  const value: ChainEpochState = { epoch, epoch1StartMs };
  globalScope.__mnemoEpochCache = { value, at: Date.now() };
  return value;
}
