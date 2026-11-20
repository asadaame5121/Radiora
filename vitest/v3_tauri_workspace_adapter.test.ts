import { describe, expect, test } from "vitest";
import { createTauriWorkspaceAdapter } from "../src/v3/tauri_workspace_adapter.ts";
import { WorkspaceCommandError } from "../src/v3/workspace_port.ts";

const A = "0190a6e0-0000-7000-8000-000000000001";

function adapterReturning(value: unknown, calls: unknown[][] = []) {
	return createTauriWorkspaceAdapter(async (...args) => {
		calls.push(args);
		return value;
	});
}

function adapterRejecting(error: unknown) {
	return createTauriWorkspaceAdapter(async () => {
		throw error;
	});
}

async function rejection(promise: Promise<unknown>): Promise<WorkspaceCommandError> {
	try {
		await promise;
	} catch (error) {
		if (error instanceof WorkspaceCommandError) return error;
		throw error;
	}
	throw new Error("expected a rejection");
}

describe("Tauri workspace adapter", () => {
	test("passes requests under the `request` argument and validates the response", async () => {
		const calls: unknown[][] = [];
		const adapter = adapterReturning({ version: 2, replayed: false }, calls);
		const request = { requestId: "r", baseVersion: 1, blockId: A, body: "本文" };
		await expect(adapter.updateBody(request)).resolves.toEqual({ version: 2, replayed: false });
		expect(calls).toEqual([["update_body", { request }]]);
	});

	test("accepts a valid committed view", async () => {
		const view = { version: 0, blocks: [{ id: A, parentId: null, index: 0, body: "" }] };
		await expect(adapterReturning(view).view()).resolves.toEqual(view);
	});

	test.each([
		["a negative version", { version: -1, blocks: [] }],
		["an unknown field", { version: 0, blocks: [], path: "C:/" }],
		[
			"a non-UUID block id",
			{ version: 0, blocks: [{ id: "x", parentId: null, index: 0, body: "" }] },
		],
	])("rejects a view with %s as invalid_response", async (_case, value) => {
		const error = await rejection(adapterReturning(value).view());
		expect(error.kind).toBe("invalid_response");
		expect(error.cause).toBeDefined();
	});

	test("maps a backend error DTO to its kind", async () => {
		const error = await rejection(
			adapterRejecting({ kind: "stale_version", message: "stale", currentVersion: 4 }).retrySave(),
		);
		expect(error.kind).toBe("stale_version");
		expect(error.currentVersion).toBe(4);
	});

	test("reports anything else as a transport failure with its cause", async () => {
		const cause = new Error("IPC closed");
		const error = await rejection(adapterRejecting(cause).newBlockId());
		expect(error.kind).toBe("transport");
		expect(error.cause).toBe(cause);
	});
});
