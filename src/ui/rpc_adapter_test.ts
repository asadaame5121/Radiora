// svelte-check includes src/ui but does not resolve Deno test imports.
// @ts-nocheck
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { createRpcAdapter, type RpcFetch } from "./rpc_adapter.ts";

interface TestBindings {
	load(id: string, count: number): Promise<{ value: string }>;
}

Deno.test("createRpcAdapter uses the RPC method, POST JSON headers, body, and result payload", async () => {
	let request: { input: RequestInfo | URL; init?: RequestInit } | undefined;
	const rpcFetch: RpcFetch = async (input, init) => {
		request = { input, init };
		return { ok: true, json: async () => ({ result: { value: "ready" } }) };
	};

	const result = await createRpcAdapter<TestBindings>(rpcFetch).load("item-1", 2);
	assertEquals(result, { value: "ready" });
	assertEquals(request, {
		input: "/api/rpc/load",
		init: {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ args: ["item-1", 2] }),
		},
	});
});

Deno.test("createRpcAdapter prefers JSON error messages and falls back for HTTP errors", async () => {
	const messageFetch: RpcFetch = async () => ({
		ok: false,
		json: async () => ({ message: "詳細な失敗" }),
	});
	await assertRejects(
		() => createRpcAdapter<TestBindings>(messageFetch).load("item", 1),
		Error,
		"詳細な失敗",
	);
	const fallbackFetch: RpcFetch = async () => ({ ok: false, json: async () => ({}) });
	await assertRejects(
		() => createRpcAdapter<TestBindings>(fallbackFetch).load("item", 1),
		Error,
		"API request failed.",
	);
});
