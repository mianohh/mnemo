import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "@/lib/mcp";
import { readMcpToken } from "@/lib/sui-auth";
import { addressNamespace } from "@/lib/sui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const unauthorized = () =>
  Response.json(
    {
      jsonrpc: "2.0",
      error: {
        code: -32001,
        message:
          "Unauthorized: pass `Authorization: Bearer <your Mnemo MCP token>` (copy it from the /memory dashboard).",
      },
      id: null,
    },
    { status: 401, headers: { "WWW-Authenticate": "Bearer" } }
  );

function addressFrom(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  return readMcpToken(match[1].trim());
}

/**
 * Streamable HTTP MCP endpoint. Stateless by design (a fresh server +
 * transport per request, JSON responses) so any warm serverless instance can
 * answer any call — no session affinity, no in-memory session table.
 */
export async function POST(req: Request) {
  const address = addressFrom(req);
  if (!address) return unauthorized();

  const server = createMcpServer(addressNamespace(address));
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true, // plain JSON instead of per-request SSE
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } catch (e) {
    console.error("[mnemo] mcp request failed:", e);
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null },
      { status: 500 }
    );
  } finally {
    await server.close().catch(() => {});
  }
}

/** No server-initiated SSE stream — clients must POST their requests. */
export function GET() {
  return new Response("Method Not Allowed: use POST (Streamable HTTP)", {
    status: 405,
    headers: { Allow: "POST, DELETE" },
  });
}

/** Stateless: every request stands alone, so close is a no-op ack. */
export function DELETE() {
  return new Response(null, { status: 200 });
}
