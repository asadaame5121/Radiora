import { describe, expect, test, vi } from "vitest";
import type { SavedRuleQuery, TransientProjectionNode } from "../src/domain/models.ts";
import { RuleQueryController } from "../src/ui/rule_query_controller.svelte.ts";

type Api = ConstructorParameters<typeof RuleQueryController>[0];

function createApi(overrides: Partial<Api> = {}): Api {
	return {
		runRuleQuery: vi.fn(async () => ({ columns: ["A"], rows: [["item"]], elapsedMs: 1 })),
		listSavedRuleQueries: vi.fn(async () => []),
		saveRuleQuery: vi.fn(async (input) => ({
			id: "query",
			...input,
			createdAt: "now",
			updatedAt: "now",
		})),
		deleteRuleQuery: vi.fn(async () => undefined),
		buildQueryProjectionNodes: vi.fn(async () => ({
			nodes: [],
			result: { columns: [], rows: [], elapsedMs: 1 },
		})),
		...overrides,
	};
}

const saved: SavedRuleQuery = {
	id: "query",
	name: "Saved",
	source: "?- item(A).",
	createdAt: "now",
	updatedAt: "now",
};

describe("rule query controller", () => {
	test("loads a transient projection and clears it when executing source", async () => {
		const node: TransientProjectionNode = {
			workId: "work",
			occurrenceId: "item",
			text: "Item",
			sourceType: "query",
		};
		const api = createApi({
			buildQueryProjectionNodes: vi.fn(async () => ({
				nodes: [node],
				result: { columns: ["A"], rows: [["item"]], elapsedMs: 1 },
			})),
		});
		const controller = new RuleQueryController(api, String);

		await controller.loadProjection(saved);
		expect(api.buildQueryProjectionNodes).toHaveBeenCalledWith(saved.id, 500);
		expect(controller.nodes).toEqual([node]);
		expect(controller.showProjection).toBe(true);
		expect(controller.source).toBe(saved.source);
		expect(api.saveRuleQuery).not.toHaveBeenCalled();

		await controller.execute();
		expect(api.runRuleQuery).toHaveBeenCalledWith(saved.source, 500);
		expect(controller.nodes).toEqual([]);
		expect(controller.result?.rows).toEqual([["item"]]);
	});

	test("saves, refreshes, removes, and reports query errors", async () => {
		const api = createApi({ listSavedRuleQueries: vi.fn(async () => [saved]) });
		const controller = new RuleQueryController(api, (cause) => (cause as Error).message);
		controller.setSource(saved.source);
		controller.setName(saved.name);

		await controller.save();
		expect(api.saveRuleQuery).toHaveBeenCalledWith({ name: saved.name, source: saved.source });
		expect(controller.savedQueries).toEqual([saved]);
		expect(controller.name).toBe("");
		await controller.remove(saved.id);
		expect(api.deleteRuleQuery).toHaveBeenCalledWith(saved.id);

		vi.mocked(api.runRuleQuery).mockRejectedValueOnce(new SyntaxError("invalid query"));
		await controller.execute();
		expect(controller.error).toBe("invalid query");
		expect(controller.result).toBeNull();
	});

	test("saves, lists, and removes search aliases", async () => {
		const mockAliases = [{ id: "alias-1", canonical: "foo", variants: ["bar", "baz"] }];
		const api = createApi({
			listSearchAliases: vi.fn(async () => mockAliases),
			saveSearchAlias: vi.fn(async () => mockAliases[0]),
			deleteSearchAlias: vi.fn(async () => undefined),
		});
		const controller = new RuleQueryController(api, String);

		await controller.loadAliases();
		expect(api.listSearchAliases).toHaveBeenCalledTimes(1);
		expect(controller.aliases).toEqual(mockAliases);

		controller.setAliasCanonical("new-canonical");
		controller.setAliasVariants("v1, v2\nv3");
		await controller.saveAlias();

		expect(api.saveSearchAlias).toHaveBeenCalledWith({
			canonical: "new-canonical",
			variants: ["v1", "v2", "v3"],
		});
		expect(controller.aliasCanonical).toBe("");
		expect(controller.aliasVariants).toBe("");

		await controller.removeAlias("alias-1");
		expect(api.deleteSearchAlias).toHaveBeenCalledWith("alias-1");
	});
});
