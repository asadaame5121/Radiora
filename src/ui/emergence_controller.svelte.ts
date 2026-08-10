import type { EmergenceAction, EmergenceSuggestion } from "../domain/models.ts";

export interface EmergenceApiPort {
	listEmergenceSuggestions(contextItemId: string, limit?: number): Promise<EmergenceSuggestion[]>;
	resolveEmergenceSuggestion(id: string, action: EmergenceAction, reason?: string): Promise<void>;
}

export interface EmergenceControllerPorts {
	api: EmergenceApiPort;
	getSelectedId(): string | null;
	reloadOutline(): Promise<unknown>;
	notifySuggestions(suggestions: readonly EmergenceSuggestion[]): void;
	reportError(cause: unknown): void;
}

export function createEmergenceController(ports: EmergenceControllerPorts) {
	let suggestions = $state<EmergenceSuggestion[]>([]);
	let resolutionReasons = $state<Record<string, string>>({});
	let loading = $state(false);
	let loadRequest = 0;
	const notifiedIds = new Set<string>();

	function clear(): void {
		loadRequest++;
		suggestions = [];
		loading = false;
	}

	async function load(contextItemId: string): Promise<void> {
		const request = ++loadRequest;
		loading = true;
		try {
			const next = await ports.api.listEmergenceSuggestions(contextItemId, 10);
			if (request !== loadRequest || ports.getSelectedId() !== contextItemId) return;
			suggestions = next;
			const unseen = next.filter((suggestion) => !notifiedIds.has(suggestion.id));
			for (const suggestion of next) notifiedIds.add(suggestion.id);
			if (unseen.length) ports.notifySuggestions(unseen);
		} catch (cause) {
			if (request === loadRequest) ports.reportError(cause);
		} finally {
			if (request === loadRequest) loading = false;
		}
	}

	function setResolutionReason(id: string, reason: string): void {
		resolutionReasons = { ...resolutionReasons, [id]: reason };
	}

	async function resolve(suggestion: EmergenceSuggestion, action: EmergenceAction): Promise<void> {
		try {
			const reason = resolutionReasons[suggestion.id]?.trim();
			await ports.api.resolveEmergenceSuggestion(suggestion.id, action, reason || undefined);
			const { [suggestion.id]: _resolved, ...remainingReasons } = resolutionReasons;
			resolutionReasons = remainingReasons;
			if (action === "accept") await ports.reloadOutline();
			const selectedId = ports.getSelectedId();
			if (selectedId) await load(selectedId);
			else clear();
		} catch (cause) {
			ports.reportError(cause);
		}
	}

	return {
		get suggestions() {
			return suggestions;
		},
		get resolutionReasons() {
			return resolutionReasons;
		},
		get loading() {
			return loading;
		},
		load,
		clear,
		setResolutionReason,
		resolve,
	};
}
