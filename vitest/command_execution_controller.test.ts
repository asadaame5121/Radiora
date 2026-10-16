import { expect, it, vi } from "vitest";
import { CommandExecutionController } from "../src/ui/command_execution_controller.ts";
import type { CommandContext } from "../src/ui/command_service.ts";
const context: CommandContext = {
	startupReady: true,
	selectedOccurrenceId: "a",
	hasSelectedBranch: true,
	hasSelectedRecoverySnapshot: false,
	canOpenLinkEditor: true,
	quickCaptureText: "draft",
	quickCaptureSubmitting: false,
	isHoisted: false,
};
it("shares availability and drops overlapping command/menu execution; failure unlocks retry", async () => {
	let release!: () => void;
	const pending = new Promise<void>((resolve) => release = resolve);
	const operation = vi.fn().mockReturnValueOnce(pending).mockRejectedValueOnce(
		new Error("write failed"),
	).mockResolvedValue(undefined);
	const error = vi.fn();
	const unavailable = vi.fn();
	const controller = new CommandExecutionController({
		context: () => context,
		operations: { quickCapture: operation },
		reportError: error,
		reportUnavailable: unavailable,
	});
	const first = controller.execute("quickCapture");
	await controller.execute("quickCapture");
	const menu = vi.fn(async () => undefined);
	await controller.run(menu);
	expect(operation).toHaveBeenCalledTimes(1);
	expect(menu).not.toHaveBeenCalled();
	release();
	await first;
	await controller.execute("quickCapture");
	expect(error).toHaveBeenCalledOnce();
	await controller.execute("quickCapture");
	expect(operation).toHaveBeenCalledTimes(3);
	await controller.execute("saveRevision");
	expect(unavailable).toHaveBeenCalledOnce();
});
it("dispose rejects new work and suppresses a late error", async () => {
	let reject!: (cause: unknown) => void;
	const pending = new Promise<void>((_resolve, no) => reject = no);
	const error = vi.fn();
	const operation = vi.fn(() => pending);
	const controller = new CommandExecutionController({
		context: () => context,
		operations: { quickCapture: operation },
		reportError: error,
		reportUnavailable: vi.fn(),
	});
	const running = controller.execute("quickCapture");
	controller.dispose();
	reject(new Error("late"));
	await running;
	await controller.execute("quickCapture");
	expect(error).not.toHaveBeenCalled();
	expect(operation).toHaveBeenCalledOnce();
});

it("dispatches available command operations with explicit payloads and skips unavailable ones", async () => {
	const operations = {
		quickCapture: vi.fn(),
		hoist: vi.fn(),
		addBookmark: vi.fn(),
		saveRevision: vi.fn(),
		createLink: vi.fn(),
	};
	const unavailable = vi.fn();
	const controller = new CommandExecutionController({
		context: () => context,
		operations,
		reportError: vi.fn(),
		reportUnavailable: unavailable,
	});

	await controller.execute("quickCapture");
	await controller.execute("hoist");
	await controller.execute("addBookmark");
	await controller.execute("saveRevision");
	await controller.execute("saveRevision", { snapshotId: "snapshot-7" });
	await controller.execute("createLink", {
		linkInput: { fromId: "from", toId: "to", type: "FROM" },
	});

	expect(operations.quickCapture).toHaveBeenCalledOnce();
	expect(operations.hoist).toHaveBeenCalledOnce();
	expect(operations.addBookmark).toHaveBeenCalledOnce();
	expect(operations.saveRevision).toHaveBeenCalledOnce();
	expect(operations.saveRevision).toHaveBeenCalledWith({ snapshotId: "snapshot-7" });
	expect(operations.createLink).toHaveBeenCalledWith({
		linkInput: { fromId: "from", toId: "to", type: "FROM" },
	});
	expect(unavailable).toHaveBeenCalledOnce();

	const unavailableController = new CommandExecutionController({
		context: () => ({ ...context, quickCaptureText: "", hasSelectedRecoverySnapshot: false }),
		operations,
		reportError: vi.fn(),
		reportUnavailable: unavailable,
	});
	await unavailableController.execute("quickCapture");
	await unavailableController.execute("saveRevision");
	expect(unavailable).toHaveBeenCalledTimes(3);
	expect(operations.quickCapture).toHaveBeenCalledOnce();
	expect(operations.saveRevision).toHaveBeenCalledOnce();
});
