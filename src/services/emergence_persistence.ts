import type {
	EmergenceAction,
	EmergenceStatus,
	EmergenceSuggestion,
	OutlineLink,
} from "../domain/models.ts";
import { isSymmetricLinkType } from "../domain/models.ts";
import type { DiscoveryStorePort } from "../storage/graph_store.ts";
import {
	type EmergenceCandidate,
	emergenceSuggestionFingerprint,
} from "./emergence_suggestion_calculator.ts";

type EmergencePersistenceStore = Pick<
	DiscoveryStorePort,
	| "getEmergenceFeedback"
	| "listEmergenceSuggestions"
	| "resolveEmergenceSuggestion"
	| "upsertEmergenceSuggestion"
>;

function statusFromFeedback(
	feedback: "accept" | "dismiss" | "pin" | null,
): EmergenceStatus {
	if (feedback === "accept") return "accepted";
	if (feedback === "dismiss") return "dismissed";
	if (feedback === "pin") return "held";
	return "pending";
}

function materializedSuggestion(
	candidate: EmergenceCandidate,
	existing: EmergenceSuggestion | undefined,
	persistenceStatus: EmergenceStatus,
): EmergenceSuggestion {
	const now = new Date().toISOString();
	return {
		...candidate,
		persistenceStatus,
		createdAt: existing?.createdAt ?? now,
		updatedAt: now,
		...(existing?.resolvedAt ? { resolvedAt: existing.resolvedAt } : {}),
		...(existing?.resolutionReason ? { resolutionReason: existing.resolutionReason } : {}),
		...(persistenceStatus === "held" ? { status: "pinned" as const } : {}),
	};
}

/** Materializes discovery candidates and owns their resolution lifecycle. */
export class EmergencePersistence {
	constructor(private readonly store: EmergencePersistenceStore) {}

	async materialize(
		candidates: readonly EmergenceCandidate[],
	): Promise<EmergenceSuggestion[]> {
		const persisted = new Map(
			(await this.store.listEmergenceSuggestions()).map((
				suggestion,
			) => [suggestion.id, suggestion]),
		);
		const visible: EmergenceSuggestion[] = [];
		for (const candidate of candidates) {
			const existing = persisted.get(candidate.id);
			const persistenceStatus = await this.#status(candidate, existing);
			const materialized = materializedSuggestion(candidate, existing, persistenceStatus);
			await this.store.upsertEmergenceSuggestion(materialized);
			if (persistenceStatus === "dismissed" || persistenceStatus === "accepted") continue;
			visible.push(materialized);
		}
		return visible;
	}

	async #status(
		candidate: EmergenceCandidate,
		existing: EmergenceSuggestion | undefined,
	): Promise<EmergenceStatus> {
		if (existing) return existing.persistenceStatus;
		const legacyId = emergenceSuggestionFingerprint(
			`${candidate.kind}:${candidate.contextItemId}:${candidate.targetItemId}`,
		);
		const feedback = await this.store.getEmergenceFeedback(candidate.id) ??
			await this.store.getEmergenceFeedback(legacyId);
		return statusFromFeedback(feedback);
	}

	async resolve(id: string, action: EmergenceAction, reason?: string): Promise<void> {
		const suggestion = (await this.store.listEmergenceSuggestions()).find((candidate) =>
			candidate.id === id &&
			(candidate.persistenceStatus === "pending" || candidate.persistenceStatus === "held")
		);
		if (!suggestion) throw new Error("提案が古くなりました。再読み込みしてください。");
		if (action !== "accept") {
			await this.store.resolveEmergenceSuggestion(id, action, undefined, reason);
			return;
		}
		if (!suggestion.proposedLinkType) throw new Error("リンク種別のない提案は採用できません。");
		let fromWorkId = suggestion.contextWorkId;
		let toWorkId = suggestion.targetWorkId;
		if (
			isSymmetricLinkType(suggestion.proposedLinkType) && fromWorkId.localeCompare(toWorkId) > 0
		) [fromWorkId, toWorkId] = [toWorkId, fromWorkId];
		const link: OutlineLink = {
			id: crypto.randomUUID(),
			fromId: fromWorkId,
			toId: toWorkId,
			from: { scope: "work", workId: fromWorkId },
			to: { scope: "work", workId: toWorkId },
			type: suggestion.proposedLinkType,
			status: "asserted",
			origin: "suggestion",
			reason: suggestion.explanation,
			createdAt: new Date().toISOString(),
		};
		await this.store.resolveEmergenceSuggestion(id, action, link, reason);
	}
}
