import type { EmergenceAction, EmergenceSuggestion } from "../domain/models.ts";
import { emergenceToastContent } from "./emergence_toast.ts";

export interface EmergenceApiPort {
	listEmergenceSuggestions(contextItemId: string, limit?: number): Promise<EmergenceSuggestion[]>;
	resolveEmergenceSuggestion(id: string, action: EmergenceAction, reason?: string): Promise<void>;
}

export interface EmergenceControllerPorts {
	api: EmergenceApiPort;
	getSelectedId(): string | null;
	titleForId(id: string): string;
	reloadOutline(): Promise<unknown>;
	reportError(cause: unknown): void;
}

function createEmergenceToastController(titleForId: (id: string) => string) {
	let content = $state<{ id: number; title: string; message: string } | null>(null);
	let nextId = 0;

	function notify(suggestions: readonly EmergenceSuggestion[]): void {
		const toast = emergenceToastContent(suggestions, titleForId);
		if (toast) content = { id: ++nextId, ...toast };
	}

	return {
		get content() {
			return content;
		},
		notify,
		dismiss: () => content = null,
	};
}

function createEmergenceResolutionState() {
	let reasons = $state<Record<string, string>>({});
	return {
		get content() {
			return reasons;
		},
		get(id: string): string | undefined {
			return reasons[id]?.trim();
		},
		set(id: string, reason: string): void {
			reasons = { ...reasons, [id]: reason };
		},
		remove(id: string): void {
			const { [id]: _resolved, ...remaining } = reasons;
			reasons = remaining;
		},
	};
}

export function createEmergenceController(ports: EmergenceControllerPorts) {
	let suggestions = $state<EmergenceSuggestion[]>([]);
	let loading = $state(false);
	let loadRequest = 0;
	const notifiedIds = new Set<string>();
	const toastController = createEmergenceToastController(ports.titleForId);
	const resolutionState = createEmergenceResolutionState();

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
			const unseen = next.filter((suggestion) =>
				suggestion.persistenceStatus === "pending" && !notifiedIds.has(suggestion.id)
			);
			for (const suggestion of next) notifiedIds.add(suggestion.id);
			if (unseen.length) toastController.notify(unseen);
		} catch (cause) {
			if (request === loadRequest) ports.reportError(cause);
		} finally {
			if (request === loadRequest) loading = false;
		}
	}

	async function resolve(suggestion: EmergenceSuggestion, action: EmergenceAction): Promise<void> {
		try {
			const reason = resolutionState.get(suggestion.id);
			await ports.api.resolveEmergenceSuggestion(suggestion.id, action, reason || undefined);
			resolutionState.remove(suggestion.id);
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
			return resolutionState.content;
		},
		get loading() {
			return loading;
		},
		get toast() {
			return toastController.content;
		},
		load,
		clear,
		dismissToast: toastController.dismiss,
		setResolutionReason: resolutionState.set,
		resolve,
	};
}
