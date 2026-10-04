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
