import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OutlineSnapshot } from "../src/domain/models.ts";
import { DEFAULT_UI_VOCABULARY as vocabulary } from "../src/shared/ui_vocabulary.ts";
import { downloadTextFile } from "../src/ui/download_text_file.ts";
import { MarkdownExportController } from "../src/ui/markdown_export_controller.svelte.ts";
import { OpmlController } from "../src/ui/opml_controller.svelte.ts";
import { JsonBackupController } from "../src/ui/json_backup_controller.svelte.ts";
import { DEFAULT_MARKDOWN_EXPORT_PREFERENCE } from "../src/ui/markdown_export_preference.ts";
import { OutlineController } from "../src/ui/outline_controller.svelte.ts";

vi.mock("../src/ui/download_text_file.ts", () => ({ downloadTextFile: vi.fn() }));

const snapshot: OutlineSnapshot = {
	items: ["A", "B"].map((id, orderKey) => ({
		id,
		workId: id,
		text: id === "A" ? "本文 [[B]]" : "別の本文",
		parentId: null,
		orderKey,
		collapsed: false,
		revisionSelector: { mode: "branch", branchId: id + "-main" },
		createdAt: "now",
		updatedAt: "now",
	})),
	links: [],
	knots: [],
	stashItemIds: [],
};

function fixture() {
	const steps: string[] = [];
	const flush = vi.fn(async () => {
		steps.push("flush");
	});
	const reload = vi.fn(async (_current?: () => boolean) => {
		steps.push("reload");
		return true;
	});
	const refreshRelations = vi.fn(async (_current: () => boolean) => {
		steps.push("relations");
	});
	const reportError = vi.fn();
	const api = {
		resolveInternalReferences: vi.fn(async () => {
			steps.push("references");
			return [];
		}),
		recordClientOperation: vi.fn(async () => {
			steps.push("log");
		}),
		exportOpml: vi.fn(async () => {
			steps.push("opml");
			return "<opml/>";
		}),
		importOpml: vi.fn(async () => {
			steps.push("import");
			return { importedCount: 2, rootOccurrenceIds: [] };
		}),
		exportJsonBackup: vi.fn(async () => {
			steps.push("json");
			return '{"format":"radiora-backup"}';
		}),
		restoreJsonBackup: vi.fn(async () => {
			steps.push("restore");
			return { workCount: 2, occurrenceCount: 2, revisionCount: 2, recoverySnapshotCount: 0 };
		}),
	};
	const tree = {
		reconcileRelations: vi.fn(() => {
			steps.push("reconcile");
		}),
	};
	const ports = {
		api,
		vocabulary,
		flush,
		reload,
		refreshRelations,
		relations: { load: refreshRelations, names: [] },
		tree,
		reportError,
		errorMessage: String,
	};
	const markdown = new MarkdownExportController({
		...ports,
		snapshot: () => snapshot,
		selectedId: () => "A",
	});
	const opml = new OpmlController(ports);
	const json = new JsonBackupController(ports);
	const file = {
		text: vi.fn(async () => {
			steps.push("text");
			return "source";
		}),
	};
	return { ...ports, steps, markdown, opml, json, file };
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.useFakeTimers();
	vi.setSystemTime(new Date(2026, 9, 6, 12));
});
afterEach(() => vi.useRealTimers());

it("Markdown preserves selected scope, reference modes, filenames and log order", async () => {
	const f = fixture();
	f.markdown.setPreference({ ...DEFAULT_MARKDOWN_EXPORT_PREFERENCE, referenceMode: "obsidian" });
	vi.mocked(downloadTextFile).mockImplementation(() => {
		f.steps.push("download");
	});
	await f.markdown.export("A");
	expect(f.api.resolveInternalReferences).toHaveBeenCalledOnce();
	expect(downloadTextFile).toHaveBeenCalledWith(
		expect.stringContaining("本文"),
		"text/markdown;charset=utf-8",
		"radiora-2026-10-06.md",
	);
	expect(vi.mocked(downloadTextFile).mock.calls[0][0]).not.toContain("別の本文");
	expect(f.steps).toEqual(["flush", "references", "download", "log"]);
	expect(f.api.recordClientOperation).toHaveBeenCalledWith(
		"export.markdown",
		"ok",
		expect.any(Number),
	);
	expect(f.markdown.notice).toBe("Markdownをエクスポートしました。");
	f.markdown.setPreference({ ...DEFAULT_MARKDOWN_EXPORT_PREFERENCE, referenceMode: "portable" });
	await f.markdown.export();
	expect(f.api.resolveInternalReferences).toHaveBeenCalledOnce();
	expect(vi.mocked(downloadTextFile).mock.calls[1][0]).toContain("別の本文");
});

it("OPML and JSON preserve flush/read/write/catalogue/reload order", async () => {
	const f = fixture();
	await f.opml.export();
	expect(downloadTextFile).toHaveBeenLastCalledWith(
		"<opml/>",
		"text/x-opml;charset=utf-8",
		"radiora-2026-10-06.opml",
	);
	expect(f.opml.notice).toBe(vocabulary.opmlExportSuccess + "。");
	await f.json.export();
	expect(downloadTextFile).toHaveBeenLastCalledWith(
		'{"format":"radiora-backup"}',
		"application/json;charset=utf-8",
		"radiora-backup-2026-10-06.json",
	);
	expect(f.json.notice).toBe(vocabulary.jsonBackupExportSuccess + "。");
	f.steps.length = 0;
	await f.opml.import(f.file);
	expect(f.steps).toEqual(["flush", "text", "import", "reload"]);
	expect(f.api.importOpml).toHaveBeenCalledWith("source");
	expect(f.opml.notice).toBe(vocabulary.opmlImportSuccess + ": 2件。");
	f.steps.length = 0;
	await f.json.restore(f.file);
	expect(f.steps).toEqual(["flush", "text", "restore", "relations", "reconcile", "reload"]);
	expect(f.api.restoreJsonBackup).toHaveBeenCalledWith("source");
	expect(f.json.notice).toBe(
		vocabulary.jsonBackupRestoreSuccess + ": 2件の" + vocabulary.work + "。",
	);
});

describe.each(["markdown", "opml", "json"] as const)("%s export failures", (kind) => {
	it("flush failure stops I/O and keeps drafts", async () => {
		const f = fixture();
		const draft = "未保存本文";
		f.flush.mockRejectedValue(new Error(draft));
		await f[kind].export();
		expect(downloadTextFile).not.toHaveBeenCalled();
		expect(f.api.exportOpml).not.toHaveBeenCalled();
		expect(f.api.exportJsonBackup).not.toHaveBeenCalled();
		expect(f.reportError).toHaveBeenCalledWith(expect.stringContaining(draft));
		expect(f[kind].notice).toBe("");
		if (kind === "markdown") {
			expect(f.api.recordClientOperation).toHaveBeenCalledWith(
				"export.markdown",
				"error",
				expect.any(Number),
			);
		}
	});
	it("export failure retains failure display and suppresses success", async () => {
		const f = fixture();
		if (kind === "markdown") {
			f.markdown.setPreference({
				...DEFAULT_MARKDOWN_EXPORT_PREFERENCE,
				referenceMode: "obsidian",
			});
			f.api.resolveInternalReferences.mockRejectedValue(new Error("export failed"));
		} else if (kind === "opml") f.api.exportOpml.mockRejectedValue(new Error("export failed"));
		else f.api.exportJsonBackup.mockRejectedValue(new Error("export failed"));
		await f[kind].export();
		expect(f.reportError).toHaveBeenCalledWith(expect.stringContaining("export failed"));
		expect(downloadTextFile).not.toHaveBeenCalled();
		expect(f[kind].notice).toBe("");
	});
	it("dispose during flush prevents external I/O", async () => {
		const f = fixture();
		let release: () => void = () => {
			throw new Error("Gate not initialized");
		};
		f.flush.mockImplementation(() =>
			new Promise<void>((resolve) => {
				release = resolve;
			})
		);
		const pending = f[kind].export();
		f[kind].dispose();
		release();
		await pending;
		expect(downloadTextFile).not.toHaveBeenCalled();
		expect(f.api.exportOpml).not.toHaveBeenCalled();
		expect(f.api.exportJsonBackup).not.toHaveBeenCalled();
		expect(f.reportError).not.toHaveBeenCalled();
	});
});

describe.each(["opml", "json"] as const)("%s import/restore failures", (kind) => {
	const run = (f: ReturnType<typeof fixture>) =>
		kind === "opml" ? f.opml.import(f.file) : f.json.restore(f.file);
	for (const stage of ["flush", "text", "write", "relations", "reload"] as const) {
		if (kind === "opml" && stage === "relations") continue;
		it(stage + " failure stops subsequent steps and retains recovery text", async () => {
			const f = fixture();
			const failure = new Error("failed");
			const failingStep = {
				flush: f.flush,
				text: f.file.text,
				write: kind === "opml" ? f.api.importOpml : f.api.restoreJsonBackup,
				relations: f.refreshRelations,
				reload: f.reload,
			}[stage];
			failingStep.mockRejectedValue(failure);
			await run(f);
			expect(f[kind].notice).toBe("");
			expect(f.reportError).toHaveBeenCalledWith(expect.stringContaining("failed"));
			if (kind === "json") {
				expect(f.reportError).toHaveBeenCalledWith(
					expect.stringContaining(vocabulary.jsonBackupRestoreFailureRecovery),
				);
			}
			if (stage !== "reload") expect(f.reload).not.toHaveBeenCalled();
			if (stage === "flush") expect(f.file.text).not.toHaveBeenCalled();
		});
	}
	it("rejected reload never publishes a success notice", async () => {
		const f = fixture();
		f.reload.mockResolvedValue(false);
		await run(f);
		expect(f[kind].notice).toBe("");
		expect(f.reportError).not.toHaveBeenCalled();
	});
	it.each(
		[
			["export", false],
			["export", true],
			["dispose", false],
			["dispose", true],
		] as const,
	)("retired reload after %s suppresses late publication (failure=%s)", async (action, failed) => {
		const f = fixture();
		const old = Promise.withResolvers<OutlineSnapshot>();
		const treeScope = { result: Promise.resolve(), publish: vi.fn(), cancel: vi.fn() };
		const bookmarkScope = { result: Promise.resolve(), publish: vi.fn(), cancel: vi.fn() };
		const ports = {
			readOutline: vi.fn(() => old.promise),
			prepareTree: () => treeScope,
			prepareBookmarks: () => bookmarkScope,
			drafts: () => [],
			reconcileSelection: vi.fn(),
			selectionReceipt: () => () => true,
			focus: vi.fn(),
			persist: vi.fn(),
			reportError: f.reportError,
			clearError: vi.fn(),
		};
		const outline = new OutlineController(ports);
		outline.restoreCache(snapshot);
		f.reload.mockImplementation((current) => outline.reload({ current }));
		const pending = run(f);
		await vi.waitFor(() => expect(ports.readOutline).toHaveBeenCalledOnce());
		if (action === "export") await f[kind].export();
		else f[kind].dispose();
		const notice = f[kind].notice;
		if (failed) old.reject(new Error("obsolete reload"));
		else old.resolve({ ...snapshot, items: [] });
		await pending;
		expect(outline.snapshot.items.map((item) => item.id)).toEqual(["A", "B"]);
		expect(f.reportError).not.toHaveBeenCalled();
		expect(ports.reconcileSelection).not.toHaveBeenCalled();
		expect(ports.persist).not.toHaveBeenCalled();
		expect(treeScope.publish).not.toHaveBeenCalled();
		expect(bookmarkScope.publish).not.toHaveBeenCalled();
		expect(treeScope.cancel).toHaveBeenCalled();
		expect(bookmarkScope.cancel).toHaveBeenCalled();
		expect(f[kind].notice).toBe(notice);
		outline.dispose();
	});
	it("a late completed write cannot reload or replace a newer notice", async () => {
		const f = fixture();
		let release: () => void = () => {
			throw new Error("Gate not initialized");
		};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		if (kind === "opml") {
			f.api.importOpml.mockImplementation(async () => {
				await gate;
				return { importedCount: 9, rootOccurrenceIds: [] };
			});
		} else {f.api.restoreJsonBackup.mockImplementation(async () => {
				await gate;
				return { workCount: 9, occurrenceCount: 9, revisionCount: 9, recoverySnapshotCount: 0 };
			});}
		const pending = run(f);
		await vi.waitFor(() =>
			expect(kind === "opml" ? f.api.importOpml : f.api.restoreJsonBackup).toHaveBeenCalled()
		);
		await f[kind].export();
		const notice = f[kind].notice;
		release();
		await pending;
		expect(f[kind].notice).toBe(notice);
		expect(f.reload).not.toHaveBeenCalled();
	});
});
