import { checkForUpdate, type UpdateCheckResult } from "../services/update_checker.ts";
import { APP_VERSION } from "../shared/app_version.ts";

export type HelpUpdateStatus = "idle" | "checking" | "current" | "available" | "unavailable";

export type HelpUpdateChecker = (currentVersion: string) => Promise<UpdateCheckResult>;

export function createHelpUpdateController(options: {
	currentVersion?: string;
	checkForUpdate?: HelpUpdateChecker;
} = {}) {
	const currentVersion = options.currentVersion ?? APP_VERSION;
	const check = options.checkForUpdate ?? checkForUpdate;
	let status = $state<HelpUpdateStatus>("idle");
	let latest = $state<UpdateCheckResult["latest"]>(null);
	let requestId = 0;

	return {
		get currentVersion() {
			return currentVersion;
		},
		get status() {
			return status;
		},
		get latest() {
			return latest;
		},
		async check(): Promise<void> {
			const activeRequestId = ++requestId;
			status = "checking";
			latest = null;
			try {
				const result = await check(currentVersion);
				if (activeRequestId !== requestId) return;
				latest = result.latest;
				status = result.error || !result.latest
					? "unavailable"
					: result.updateAvailable
					? "available"
					: "current";
			} catch {
				if (activeRequestId !== requestId) return;
				latest = null;
				status = "unavailable";
			}
		},
		dispose(): void {
			requestId++;
		},
	};
}
