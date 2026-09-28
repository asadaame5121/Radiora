import { describe, expect, test, vi } from "vitest";
import { SearchAliasController } from "../src/ui/search_alias_controller.svelte.ts";

describe("search alias controller", () => {
	test("saves, lists, and removes search aliases through bound callbacks", async () => {
		const aliases = [{ id: "alias-1", canonical: "foo", variants: ["bar", "baz"] }];
		const api = {
			listSearchAliases: vi.fn(async () => aliases),
			saveSearchAlias: vi.fn(async () => aliases[0]),
			deleteSearchAlias: vi.fn(async () => undefined),
		};
		const controller = new SearchAliasController(api, String);
		const viewCallbacks = { onSaveAlias: controller.save, onRemoveAlias: controller.remove };

		await controller.load();
		expect(controller.aliases).toEqual(aliases);
		controller.setCanonical("new-canonical");
		controller.setVariants("v1, v2\nv3");
		await viewCallbacks.onSaveAlias();

		expect(api.saveSearchAlias).toHaveBeenCalledWith({
			canonical: "new-canonical",
			variants: ["v1", "v2", "v3"],
		});
		expect(controller.canonical).toBe("");
		expect(controller.variants).toBe("");

		await viewCallbacks.onRemoveAlias("alias-1");
		expect(api.deleteSearchAlias).toHaveBeenCalledWith("alias-1");
	});
});
