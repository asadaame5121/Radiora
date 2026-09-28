import { describe, expect, it, vi } from "vitest";
import type { ScopedTagSet, TagAlias } from "../src/domain/models.ts";
import { splitTagInput, TagController } from "../src/ui/tag_controller.svelte.ts";

describe("splitTagInput", () => {
	it("splits tags by commas, Japanese commas, or spaces and trims", () => {
		expect(splitTagInput("tag1, tag2、 tag3   tag4")).toEqual([
			"tag1",
			"tag2",
			"tag3",
			"tag4",
		]);
	});

	it("returns empty array for empty string", () => {
		expect(splitTagInput("  , 、 ")).toEqual([]);
	});
});

describe("TagController", () => {
	const mockScopes: ScopedTagSet[] = [
		{ scope: { workId: "w1", branchId: "b1" }, tags: ["tag1", "common"] },
	];
	const mockAliases: TagAlias[] = [
		{ id: "a1", canonical: "tag1", alias: "alias1" },
	];

	function createController(overrides?: {
		listScopedTags?: () => Promise<ScopedTagSet[]>;
		listTagAliases?: () => Promise<TagAlias[]>;
		renameTag?: (from: string, to: string) => Promise<void>;
		mergeTags?: (sources: string[], target: string) => Promise<void>;
	}) {
		const api = {
			listScopedTags: overrides?.listScopedTags ?? vi.fn().mockResolvedValue(mockScopes),
			listTagAliases: overrides?.listTagAliases ?? vi.fn().mockResolvedValue(mockAliases),
			renameTag: overrides?.renameTag ?? vi.fn().mockResolvedValue(undefined),
			mergeTags: overrides?.mergeTags ?? vi.fn().mockResolvedValue(undefined),
		};
		const controller = new TagController({
			api,
			errorMessage: (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)),
		});
		return { controller, api };
	}

	it("initializes with empty states", () => {
		const { controller } = createController();
		expect(controller.scopes).toEqual([]);
		expect(controller.aliases).toEqual([]);
		expect(controller.selectedTag).toBeNull();
		expect(controller.renameFrom).toBe("");
		expect(controller.renameTo).toBe("");
		expect(controller.mergeSources).toBe("");
		expect(controller.mergeTarget).toBe("");
		expect(controller.error).toBe("");
	});

	it("loads scopes and aliases", async () => {
		const { controller, api } = createController();
		await controller.load();

		expect(api.listScopedTags).toHaveBeenCalledTimes(1);
		expect(api.listTagAliases).toHaveBeenCalledTimes(1);
		expect(controller.scopes).toEqual(mockScopes);
		expect(controller.aliases).toEqual(mockAliases);
		expect(controller.error).toBe("");
	});

	it("clears selectedTag when it is no longer in loaded scopes", async () => {
		const { controller } = createController();
		controller.selectedTag = "non-existent";
		await controller.load();
		expect(controller.selectedTag).toBeNull();
	});

	it("renames tag successfully and resets inputs", async () => {
		const { controller, api } = createController();
		controller.renameFrom = "tag1";
		controller.renameTo = "tag2";

		await controller.rename();

		expect(api.renameTag).toHaveBeenCalledWith("tag1", "tag2");
		expect(controller.renameFrom).toBe("");
		expect(controller.renameTo).toBe("");
	});

	it("merges tags successfully and resets inputs", async () => {
		const { controller, api } = createController();
		controller.mergeSources = "tag1, tag2";
		controller.mergeTarget = "tag-merged";

		await controller.merge();

		expect(api.mergeTags).toHaveBeenCalledWith(["tag1", "tag2"], "tag-merged");
		expect(controller.mergeSources).toBe("");
		expect(controller.mergeTarget).toBe("");
	});

	it("captures error when rename fails", async () => {
		const { controller } = createController({
			renameTag: vi.fn().mockRejectedValue(new Error("Rename failed")),
		});
		controller.renameFrom = "tag1";
		controller.renameTo = "tag2";

		await controller.rename();

		expect(controller.error).toBe("Rename failed");
	});
});
