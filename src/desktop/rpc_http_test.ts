// biome-ignore-all lint/style/noMagicNumbers: HTTP status codes, argument payloads, and call counts are protocol inputs.
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
	createRpcHttpHandler,
	RPC_PATH_PREFIX,
	type RpcHandlers,
	type RpcHttpPorts,
	type RpcOperationRecord,
} from "./rpc_http.ts";

const testOrigin = "http://127.0.0.1:4123";

interface Harness {
	handle(request: Request): Promise<Response>;
	readonly operations: RpcOperationRecord[];
	readonly measuredMethods: string[];
}

function createHarness(
	handlers: RpcHandlers,
	options: { onStartupStatusPoll?: () => void } = {},
): Harness {
	const operations: RpcOperationRecord[] = [];
	const measuredMethods: string[] = [];
	const ports: RpcHttpPorts = {
		handlers,
		recordOperation: (record) => operations.push(record),
		measureRequest: (method, invoke) => {
			measuredMethods.push(method);
			return invoke();
		},
		onStartupStatusPoll: options.onStartupStatusPoll,
	};
	return { handle: createRpcHttpHandler(ports), operations, measuredMethods };
}

function post(method: string, body?: BodyInit | null): Request {
	return new Request(`${testOrigin}${RPC_PATH_PREFIX}${method}`, {
		method: "POST",
		body: body ?? null,
	});
}

Deno.test("rpc_http dispatches a JSON args payload to the named handler and serializes the result", async () => {
	const received: unknown[][] = [];
	const harness = createHarness({
		listOutline: (...args: unknown[]) => {
			received.push(args);
			return { items: [{ id: "work-1" }] };
		},
	});

	const response = await harness.handle(
		post("listOutline", JSON.stringify({ args: ["work-1", 2] })),
	);

	assertEquals(response.status, 200);
	assert(response.headers.get("content-type")?.includes("application/json") === true);
	assertEquals(await response.json(), { result: { items: [{ id: "work-1" }] } });
	assertEquals(received, [["work-1", 2]]);
	assertEquals(harness.measuredMethods, ["listOutline"]);
	assertEquals(harness.operations.length, 1);
	assertEquals(harness.operations[0].method, "listOutline");
	assertEquals(harness.operations[0].outcome, "ok");
	assert(harness.operations[0].durationMs >= 0);
});

Deno.test("rpc_http normalizes null and undefined handler results to a null result envelope", async () => {
	const harness = createHarness({ explicitNull: () => null, implicitNull: () => undefined });

	assertEquals(await (await harness.handle(post("explicitNull", "{}"))).json(), { result: null });
	assertEquals(await (await harness.handle(post("implicitNull", "{}"))).json(), { result: null });
	assertEquals(harness.operations.map((record) => record.outcome), ["ok", "ok"]);
});

Deno.test("rpc_http answers unknown, inherited, and prototype names with 404 without invoking handlers", async () => {
	const calls: string[] = [];
	const harness = createHarness({
		listOutline: () => {
			calls.push("listOutline");
			return null;
		},
		notCallable: 42,
	});

	const names = [
		"missing",
		"toString",
		"constructor",
		"__proto__",
		"hasOwnProperty",
		"listOutline/extra",
		"notCallable",
	];
	for (const name of names) {
		const response = await harness.handle(post(name, JSON.stringify({ args: [] })));
		assertEquals(response.status, 404, name);
		assertEquals(await response.json(), { message: "Unknown API method." }, name);
	}
	assertEquals(calls, []);
	assertEquals(harness.measuredMethods, []);
	assertEquals(harness.operations, []);
});

Deno.test("rpc_http requires POST for a known method and keeps the unknown-method envelope for other verbs", async () => {
	const calls: string[] = [];
	const harness = createHarness({
		listOutline: () => {
			calls.push("listOutline");
			return null;
		},
	});

	for (const httpMethod of ["GET", "PUT", "DELETE"]) {
		const response = await harness.handle(
			new Request(`${testOrigin}${RPC_PATH_PREFIX}listOutline`, { method: httpMethod }),
		);
		assertEquals(response.status, 404, httpMethod);
		assertEquals(
			await response.text(),
			JSON.stringify({ message: "Unknown API method." }),
			httpMethod,
		);
	}
	assertEquals(calls, []);
	assertEquals(harness.operations, []);
});

Deno.test("rpc_http rejects malformed request bodies with 400 before any handler runs", async () => {
	const received: unknown[][] = [];
	const harness = createHarness({
		createItem: (...args: unknown[]) => {
			received.push(args);
			return null;
		},
	});

	const malformed: (string | undefined)[] = [
		undefined,
		"",
		"   ",
		"not json",
		"null",
		"5",
		'"text"',
		"[]",
		"[{}]",
		'{"args":"abc"}',
		'{"args":{}}',
		'{"args":{"0":"a"}}',
	];
	for (const body of malformed) {
		const response = await harness.handle(post("createItem", body));
		assertEquals(response.status, 400, body);
		assertEquals(await response.json(), { message: "Invalid RPC request body." }, body);
	}

	assertEquals(received, []);
	assertEquals(harness.measuredMethods.length, malformed.length);
	assertEquals(harness.operations.length, malformed.length);
	assert(harness.operations.every((record) => record.outcome === "error"));
	assert(
		harness.operations.every((record) =>
			typeof record.errorName === "string" && record.errorName.length > 0
		),
	);
});

Deno.test("rpc_http treats an empty object body and a null args value as zero arguments", async () => {
	const received: unknown[][] = [];
	const harness = createHarness({
		listOutline: (...args: unknown[]) => {
			received.push(args);
			return null;
		},
	});

	for (const body of ["{}", '{"args":null}', '{"unrelated":1}', '{"args":[]}']) {
		const response = await harness.handle(post("listOutline", body));
		assertEquals(response.status, 200, body);
		assertEquals(await response.json(), { result: null }, body);
	}
	assertEquals(received.map((args) => args.length), [0, 0, 0, 0]);
});

Deno.test("rpc_http answers handler failures with the 500 envelope and records the attempt", async () => {
	const harness = createHarness({
		throwing: () => {
			throw new Error("保存に失敗しました");
		},
		rejecting: () => Promise.reject("offline"),
	});

	const thrown = await harness.handle(post("throwing", "{}"));
	assertEquals(thrown.status, 500);
	assertEquals(await thrown.json(), { message: "保存に失敗しました" });

	const rejected = await harness.handle(post("rejecting", "{}"));
	assertEquals(rejected.status, 500);
	assertEquals(await rejected.json(), { message: "offline" });

	assertEquals(
		harness.operations.map((record) => [record.method, record.outcome, record.errorName]),
		[
			["throwing", "error", "Error"],
			["rejecting", "error", "UnknownError"],
		],
	);
	assertEquals(harness.measuredMethods, ["throwing", "rejecting"]);
});

Deno.test("rpc_http invokes each handler exactly once, even when it fails", async () => {
	const calls: string[] = [];
	const harness = createHarness({
		ok: () => {
			calls.push("ok");
			return "value";
		},
		fail: () => {
			calls.push("fail");
			throw new Error("boom");
		},
	});

	assertEquals(await (await harness.handle(post("ok", "{}"))).json(), { result: "value" });
	assertEquals((await harness.handle(post("fail", "{}"))).status, 500);
	assertEquals(calls, ["ok", "fail"]);
	assertEquals(harness.measuredMethods, ["ok", "fail"]);
});

Deno.test("rpc_http answers a failing measurement hook with the 500 envelope and never runs the handler", async () => {
	const calls: string[] = [];
	const operations: RpcOperationRecord[] = [];
	const handle = createRpcHttpHandler({
		handlers: {
			listOutline: () => {
				calls.push("listOutline");
				return null;
			},
		},
		recordOperation: (record) => operations.push(record),
		measureRequest: () => Promise.reject(new Error("timing hook failed")),
	});

	const response = await handle(post("listOutline"));
	assertEquals(response.status, 500);
	assertEquals(await response.json(), { message: "timing hook failed" });
	assertEquals(calls, []);
	assertEquals(operations.map((record) => [record.method, record.outcome]), [
		["listOutline", "error"],
	]);
});

Deno.test("rpc_http asks the host to bootstrap after body validation and before the startup-status handler", async () => {
	const events: string[] = [];
	const harness = createHarness(
		{
			getStartupStatus: () => {
				events.push("handler");
				return { phase: "starting" };
			},
		},
		{ onStartupStatusPoll: () => events.push("poll") },
	);

	const polled = await harness.handle(post("getStartupStatus", JSON.stringify({ args: [] })));
	assertEquals(await polled.json(), { result: { phase: "starting" } });
	assertEquals(events, ["poll", "handler"]);

	events.length = 0;
	assertEquals((await harness.handle(post("getStartupStatus", "{}"))).status, 200);
	assertEquals(events, ["poll", "handler"]);

	events.length = 0;
	const malformed = await harness.handle(post("getStartupStatus", "not json"));
	assertEquals(malformed.status, 400);
	assertEquals(await malformed.json(), { message: "Invalid RPC request body." });
	assertEquals(events, []);

	const absentBody = await harness.handle(post("getStartupStatus"));
	assertEquals(absentBody.status, 400);
	assertEquals(await absentBody.json(), { message: "Invalid RPC request body." });
	assertEquals(events, []);

	const wrongVerb = await harness.handle(
		new Request(`${testOrigin}${RPC_PATH_PREFIX}getStartupStatus`, { method: "GET" }),
	);
	assertEquals(wrongVerb.status, 404);
	const unknownName = await harness.handle(post("getStartupStatusLater"));
	assertEquals(unknownName.status, 404);
	assertEquals(events, []);

	const withoutPort = createHarness({ getStartupStatus: () => null });
	assertEquals((await withoutPort.handle(post("getStartupStatus", "{}"))).status, 200);
});

Deno.test("rpc_http resolves the method from the path and ignores the query string", async () => {
	const harness = createHarness({ listOutline: () => "ok" });

	const response = await harness.handle(
		new Request(`${testOrigin}${RPC_PATH_PREFIX}listOutline?verbose=1`, {
			method: "POST",
			body: JSON.stringify({ args: [] }),
		}),
	);
	assertEquals(await response.json(), { result: "ok" });
	assertEquals(harness.operations.map((record) => record.method), ["listOutline"]);
});
