export type RpcFetch = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Pick<Response, "ok" | "json">>;

/** Creates the browser-side RPC facade without coupling UI state to transport details. */
export function createRpcAdapter<T extends object>(rpcFetch: RpcFetch = fetch): T {
	return new Proxy({}, {
		get: (_target, property) => async (...args: unknown[]) => {
			const response = await rpcFetch(`/api/rpc/${String(property)}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ args }),
			});
			const payload = await response.json() as { result?: unknown; message?: unknown };
			if (!response.ok) {
				throw new Error(
					typeof payload.message === "string" ? payload.message : "API request failed.",
				);
			}
			return payload.result;
		},
	}) as T;
}
