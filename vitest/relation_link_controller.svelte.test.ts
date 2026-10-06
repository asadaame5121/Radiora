import { describe, expect, it, vi } from "vitest";
import type { CreateLinkInput, OutlineLink } from "../src/domain/models.ts";
import { RelationLinkController } from "../src/ui/relation_link_controller.svelte.ts";

describe("RelationLinkController", () => {
	it("adds a link and reloads", async () => {
		const createLink = vi.fn().mockResolvedValue(undefined);
		const reload = vi.fn().mockResolvedValue(undefined);
		const controller = new RelationLinkController({
			createLink,
			deleteLink: vi.fn(),
			resolveAdvancedLink: vi.fn(),
			isSymmetric: () => false,
			reload,
			errorMessage: String,
		});

		const input: CreateLinkInput = {
			fromId: "from-1",
			toId: "to-1",
			type: "relates_to",
			origin: "human",
			status: "asserted",
		};
		await controller.addLink(input);
		expect(createLink).toHaveBeenCalledWith(input);
		expect(reload).toHaveBeenCalled();
	});

	it("removes a link and reloads", async () => {
		const deleteLink = vi.fn().mockResolvedValue(undefined);
		const reload = vi.fn().mockResolvedValue(undefined);
		const controller = new RelationLinkController({
			createLink: vi.fn(),
			deleteLink,
			resolveAdvancedLink: vi.fn(),
			isSymmetric: () => false,
			reload,
			errorMessage: String,
		});

		const link: OutlineLink = {
			id: "link-1",
			fromId: "a",
			toId: "b",
			type: "parent_of",
			origin: "human",
			status: "asserted",
		};
		await controller.removeLink(link);
		expect(deleteLink).toHaveBeenCalledWith("a", "b", "parent_of");
		expect(reload).toHaveBeenCalled();
	});

	it("reverses a non-symmetric directed link", async () => {
		const deleteLink = vi.fn().mockResolvedValue(undefined);
		const createLink = vi.fn().mockResolvedValue(undefined);
		const reload = vi.fn().mockResolvedValue(undefined);
		const controller = new RelationLinkController({
			createLink,
			deleteLink,
			resolveAdvancedLink: vi.fn(),
			isSymmetric: () => false,
			reload,
			errorMessage: String,
		});

		const link: OutlineLink = {
			id: "link-1",
			fromId: "a",
			toId: "b",
			from: "start",
			to: "end",
			type: "depends_on",
			origin: "human",
			status: "asserted",
			reason: "test",
		};
		await controller.reverseLink(link);
		expect(deleteLink).toHaveBeenCalledWith("a", "b", "depends_on");
		expect(createLink).toHaveBeenCalledWith({
			fromId: "b",
			toId: "a",
			fromEndpoint: "end",
			toEndpoint: "start",
			type: "depends_on",
			status: "asserted",
			origin: "human",
			reason: "test",
		});
		expect(reload).toHaveBeenCalled();
	});

	it("does not reverse symmetric or derived links", async () => {
		const deleteLink = vi.fn();
		const createLink = vi.fn();
		const controller = new RelationLinkController({
			createLink,
			deleteLink,
			resolveAdvancedLink: vi.fn(),
			isSymmetric: (type) => type === "related",
			reload: vi.fn(),
			errorMessage: String,
		});

		const symmetricLink: OutlineLink = {
			id: "link-1",
			fromId: "a",
			toId: "b",
			type: "related",
			origin: "human",
			status: "asserted",
		};
		await controller.reverseLink(symmetricLink);
		expect(deleteLink).not.toHaveBeenCalled();

		const derivedLink: OutlineLink = {
			id: "link-2",
			fromId: "a",
			toId: "b",
			type: "derived_from",
			origin: "derived",
			status: "asserted",
		};
		await controller.reverseLink(derivedLink);
		expect(deleteLink).not.toHaveBeenCalled();
	});

	it("inspects candidates successfully", async () => {
		const resolveAdvancedLink = vi.fn().mockResolvedValue({
			source: { status: "resolved" },
			target: { status: "resolved" },
		});
		const controller = new RelationLinkController({
			createLink: vi.fn(),
			deleteLink: vi.fn(),
			resolveAdvancedLink,
			isSymmetric: () => false,
			reload: vi.fn(),
			errorMessage: String,
		});

		const notice = await controller.inspectCandidate({
			source: "Item A",
			target: "Item B",
			type: "relates_to",
		});
		expect(resolveAdvancedLink).toHaveBeenCalledWith('"Item A" :: relates_to :: "Item B"');
		expect(notice).toContain("候補を解決しました: relates_to · Item A → Item B");
	});
});
