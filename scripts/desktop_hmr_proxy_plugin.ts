import { readFile } from "node:fs/promises";
import type { Plugin } from "vite";

const BRIDGE_FILE_ENV = "RADIORA_HMR_BRIDGE_FILE";
type ProxyRequest = AsyncIterable<Uint8Array> & {
	url?: string;
	method?: string;
	headers: Record<string, string | string[] | undefined>;
};
type ProxyResponse = {
	statusCode: number;
	setHeader(name: string, value: string): void;
	end(chunk?: Uint8Array | string): void;
};

/**
 * For desktop HMR, the renderer lives on Vite while the Deno process owns the
 * API. Keep browser requests same-origin by proxying only `/api/*` here.
 */
export function desktopHmrProxyPlugin(): Plugin {
	const bridgeFile = process.env[BRIDGE_FILE_ENV];
	if (!bridgeFile) return { name: "radiora-desktop-hmr-proxy" };

	return {
		name: "radiora-desktop-hmr-proxy",
		configureServer(server) {
			server.middlewares.use((request, response, next) => {
				if (!request.url?.startsWith("/api/")) return next();
				void proxyApiRequest(bridgeFile, request, response).catch(next);
			});
		},
	};
}

async function proxyApiRequest(
	bridgeFile: string,
	request: ProxyRequest,
	response: ProxyResponse,
): Promise<void> {
	const backendOrigin = await readBackendOrigin(bridgeFile);
	if (!backendOrigin) {
		response.statusCode = 503;
		response.setHeader("content-type", "application/json; charset=utf-8");
		response.end(JSON.stringify({ message: "Radiora desktop backend is starting." }));
		return;
	}

	const headers = new Headers();
	for (const [name, value] of Object.entries(request.headers)) {
		if (name === "host" || value == null) continue;
		headers.set(name, Array.isArray(value) ? value.join(", ") : value);
	}
	const method = request.method ?? "GET";
	const body = method === "GET" || method === "HEAD" ? undefined : await readRequestBody(request);
	const upstream = await fetch(new URL(request.url!, backendOrigin), {
		method,
		headers,
		body,
	});

	response.statusCode = upstream.status;
	for (const [name, value] of upstream.headers) {
		if (name !== "transfer-encoding") response.setHeader(name, value);
	}
	response.end(new Uint8Array(await upstream.arrayBuffer()));
}

async function readBackendOrigin(bridgeFile: string): Promise<string | null> {
	try {
		const { backendOrigin } = JSON.parse(await readFile(bridgeFile, "utf8")) as {
			backendOrigin?: unknown;
		};
		if (typeof backendOrigin !== "string") return null;
		const url = new URL(backendOrigin);
		return url.protocol === "http:" && url.hostname === "127.0.0.1" ? url.origin : null;
	} catch {
		return null;
	}
}

async function readRequestBody(request: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
	const chunks: Uint8Array[] = [];
	for await (const chunk of request) chunks.push(chunk);
	const body = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return body;
}
