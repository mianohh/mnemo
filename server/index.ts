import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { POST as authLogin } from "../src/app/api/auth/login/route";
import { POST as authLogout } from "../src/app/api/auth/logout/route";
import { GET as authSession } from "../src/app/api/auth/session/route";
import { POST as chatPost } from "../src/app/api/chat/route";
import { GET as healthGet } from "../src/app/api/health/route";
import { POST as mcpPost, GET as mcpGet, DELETE as mcpDelete } from "../src/app/api/mcp/route";
import { GET as memoryGet } from "../src/app/api/memory/route";

type Handler = (req: Request) => Response | Promise<Response>;

const ROUTES: Record<string, Record<string, Handler>> = {
  "/api/auth/login": { POST: authLogin },
  "/api/auth/logout": { POST: authLogout },
  "/api/auth/session": { GET: authSession },
  "/api/chat": { POST: chatPost },
  "/api/memory": { GET: memoryGet },
  "/api/health": { GET: healthGet },
  "/api/mcp": { GET: mcpGet, POST: mcpPost, DELETE: mcpDelete },
};

function allowedOrigins(): string[] {
  return (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function originAllowed(origin: string, req: IncomingMessage): boolean {
  if (allowedOrigins().includes(origin)) return true;
  const host = req.headers.host;
  return Boolean(host) && (origin === `http://${host}` || origin === `https://${host}`);
}

function corsHeaders(origin: string | undefined, req: IncomingMessage): Record<string, string> {
  if (!origin || !originAllowed(origin, req)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
}

function preflightHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Access-Control-Max-Age": "86400",
  };
}

function toRequest(req: IncomingMessage): Request {
  const proto = String(req.headers["x-forwarded-proto"] ?? "http").split(",")[0].trim();
  const url = `${proto}://${req.headers.host ?? "localhost"}${req.url ?? "/"}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  const method = req.method ?? "GET";
  const init: RequestInit & { duplex?: "half" } = { method, headers };
  if (method !== "GET" && method !== "HEAD") {
    init.body = Readable.toWeb(req) as unknown as ReadableStream;
    init.duplex = "half";
  }
  return new Request(url, init);
}

function send(res: ServerResponse, response: Response): void {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    if (key !== "set-cookie") res.setHeader(key, value);
  });
  const setCookies = response.headers.getSetCookie?.() ?? [];
  if (setCookies.length > 0) res.setHeader("set-cookie", setCookies);

  if (!response.body) {
    res.end();
    return;
  }
  const stream = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
  res.on("close", () => stream.destroy());
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const origin = req.headers.origin;
  const method = req.method ?? "GET";

  if (method === "OPTIONS") {
    res.statusCode = origin && originAllowed(origin, req) ? 204 : 403;
    for (const [k, v] of Object.entries({ ...corsHeaders(origin, req), ...preflightHeaders() })) {
      res.setHeader(k, v);
    }
    res.end();
    return;
  }

  if (origin && !originAllowed(origin, req)) {
    res.statusCode = 403;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "Origin not allowed" }));
    return;
  }

  const request = toRequest(req);
  const pathname = new URL(request.url).pathname;
  res.on("finish", () => {
    console.log(`[mnemo] ${method} ${pathname} ${res.statusCode} origin=${origin ?? "-"}`);
  });
  for (const [k, v] of Object.entries(corsHeaders(origin, req))) res.setHeader(k, v);

  const route = ROUTES[pathname];
  const handler = route?.[method];
  if (!handler) {
    res.statusCode = route ? 405 : 404;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: route ? "Method not allowed" : "Not found" }));
    return;
  }

  try {
    const response = await handler(request);
    send(res, response);
  } catch (e) {
    console.error("[mnemo] unhandled request error:", e);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "Internal error" }));
    } else {
      res.destroy();
    }
  }
}

const port = Number(process.env.PORT ?? 4000);
createServer((req, res) => {
  void handle(req, res);
}).listen(port, () => {
  console.log(`[mnemo] api listening on http://localhost:${port}`);
});
