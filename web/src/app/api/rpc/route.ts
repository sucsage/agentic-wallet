import { config } from "@/lib/config";
import { HttpError, errorResponse, rateLimit } from "@/lib/guard";

/**
 * Public, read-only JSON-RPC for the private chain, so reviewers can verify transaction hashes with
 * their own tools (cast, viem, ethers) instead of trusting our explorer. Only reading methods pass;
 * sending transactions stays with the server's keys (the chain's account permissioning enforces it too).
 */
const READ_ONLY = new Set([
  "eth_chainId",
  "net_version",
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getTransactionCount",
  "eth_getBalance",
  "eth_getCode",
  "eth_getStorageAt",
  "eth_call",
  "eth_estimateGas",
  "eth_getLogs",
  "eth_gasPrice",
  "web3_clientVersion",
]);
/** eth_getLogs over a huge range would tie up the node; reviewers can page through. */
const MAX_LOG_RANGE = 5_000;

type Call = { jsonrpc?: string; id?: unknown; method?: unknown; params?: unknown };

function check(c: Call) {
  if (typeof c.method !== "string" || !READ_ONLY.has(c.method)) return `Method not allowed (read-only RPC): ${String(c.method)}`;
  if (c.method === "eth_getLogs") {
    const f = (Array.isArray(c.params) ? c.params[0] : null) as { fromBlock?: string; toBlock?: string; blockHash?: string } | null;
    if (f && !f.blockHash) {
      const from = f.fromBlock?.startsWith("0x") ? Number(f.fromBlock) : null;
      const to = f.toBlock?.startsWith("0x") ? Number(f.toBlock) : null;
      if (from === null || to === null || to - from > MAX_LOG_RANGE) return `eth_getLogs needs hex fromBlock/toBlock at most ${MAX_LOG_RANGE} blocks apart`;
    }
  }
  return null;
}

export async function POST(req: Request) {
  try {
    rateLimit(req, "rpc", 600, 60 * 60 * 1000);
    const body = (await req.json().catch(() => null)) as Call | Call[] | null;
    if (!body) throw new HttpError(400, "Send a JSON-RPC request");
    const calls = Array.isArray(body) ? body : [body];
    if (calls.length === 0 || calls.length > 20) throw new HttpError(400, "Send 1 to 20 calls");
    const refused = calls.map(check);
    if (refused.some(Boolean)) {
      const errors = calls.map((c, i) => ({ jsonrpc: "2.0", id: c.id ?? null, error: { code: -32601, message: refused[i] ?? "Not sent: another call in the batch was refused" } }));
      return Response.json(Array.isArray(body) ? errors : errors[0]);
    }
    const res = await fetch(config.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json", ...(config.rpcHeaders ?? {}) },
      body: JSON.stringify(body),
    });
    return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Browsers' preflight, so web tools can call it too. */
export function OPTIONS() {
  return new Response(null, {
    headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type" },
  });
}

/** A short how-to for anyone who opens the URL in a browser. */
export function GET() {
  return Response.json({
    chainId: config.chain.id,
    name: config.chain.name,
    usage: "POST JSON-RPC here. Read-only methods only, e.g. eth_getTransactionReceipt.",
    methods: [...READ_ONLY],
    explorer: "/explorer",
  });
}
