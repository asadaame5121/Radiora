import type {
	CreateItemInput,
	CreateLinkInput,
	LinkType,
	OutlineItem,
	OutlineSnapshot,
	TrashEntry,
	UnplacedWork,
} from "../domain/models.ts";
import type { DuplicateCandidate } from "../services/duplicate_candidates.ts";
import type { CreatedStub, StubListEntry } from "../services/stub_service.ts";
import type { WorkMergePreview } from "../services/work_merge_service.ts";
import type { PendingConfirmation } from "./confirmation_controller.svelte.ts";
import type { QuickCaptureDestination } from "./quick_capture_preference.ts";

export type WorkView = "outline" | "unplaced" | "stubs" | "duplicates" | "trash";
export type UnplacedLinkDirection = "from" | "to";

export interface WorkApiPort {
	createItem(input: CreateItemInput): Promise<OutlineItem>;
	quickCapture(text: string): Promise<UnplacedWork>;
	listUnplacedWorks(): Promise<UnplacedWork[]>;
	updateUnplacedWorkText(workId: string, text: string): Promise<void>;
	placeUnplacedWork(input: { workId: string; parentId: string | null }): Promise<OutlineItem>;
	listStubs(): Promise<StubListEntry[]>;
	createStub(createdVia: "stub-list"): Promise<CreatedStub>;
	resolveStub(workId: string): Promise<void>;
	listDuplicateCandidates(): Promise<DuplicateCandidate[]>;
	createLink(input: CreateLinkInput): Promise<void>;
	previewWorkMerge(sourceWorkId: string, survivorWorkId: string): Promise<WorkMergePreview>;
	mergeWorks(preview: WorkMergePreview): Promise<void>;
	trashWork(occurrenceId: string): Promise<void>;
	listTrash(): Promise<TrashEntry[]>;
	restoreWork(workId: string): Promise<void>;
	purgeWork(workId: string): Promise<unknown>;
}

export interface WorkControllerPorts {
	api: WorkApiPort;
	getSnapshot(): OutlineSnapshot;
	reload(focusId?: string): Promise<unknown>;
	openView(view: WorkView): void;
	selectOccurrence(id: string | null): void;
	requestConfirmation(confirmation: PendingConfirmation): Promise<void>;
	reportError(cause: unknown): void;
	clearQuickCaptureInput?(): void;
	reloadBookmarks?(): Promise<void>;
}

export function duplicateCandidateKey(candidate: DuplicateCandidate): string {
	return [candidate.workA.workId, candidate.workB.workId].sort().join(":");
}

export function duplicateCandidateReason(candidate: DuplicateCandidate): string {
	return candidate.reasons.map((reason) => reason.label).join(" / ");
}

export function createWorkController(ports: WorkControllerPorts) {
	let quickCaptureSubmitting = $state(false);
	let unplacedWorks = $state<UnplacedWork[]>([]);
	let stubEntries = $state<StubListEntry[]>([]);
	let duplicateCandidates = $state<DuplicateCandidate[]>([]);
	let excludedDuplicateCandidateKeys = $state<string[]>([]);
	let unplacedLinkTargets = $state<Record<string, string>>({});
	let unplacedLinkDirections = $state<Record<string, UnplacedLinkDirection>>({});
	let unplacedLinkType = $state<LinkType>("RELATED");
	let trashEntries = $state<TrashEntry[]>([]);

	function report(cause: unknown): void {
		ports.reportError(cause);
	}

	async function performQuickCapture(
		text: string,
		destination: QuickCaptureDestination,
	): Promise<void> {
		quickCaptureSubmitting = true;
		try {
			if (destination === "root") {
				const roots = ports.getSnapshot().items
					.filter((item) => item.parentId === null)
					.sort((left, right) => left.orderKey - right.orderKey);
				const created = await ports.api.createItem({
					text,
					parentId: null,
					afterId: roots.at(-1)?.id ?? null,
				});
				ports.openView("outline");
				await ports.reload(created.id);
			} else {
				await ports.api.quickCapture(text);
				await Promise.all([ports.reload(), loadUnplacedWorks()]);
			}
			ports.clearQuickCaptureInput?.();
		} catch (cause) {
			report(cause);
		} finally {
			quickCaptureSubmitting = false;
		}
	}

	async function loadUnplacedWorks(): Promise<void> {
		unplacedWorks = await ports.api.listUnplacedWorks();
	}

	async function openUnplaced(): Promise<void> {
		try {
			await loadUnplacedWorks();
			ports.openView("unplaced");
		} catch (cause) {
			report(cause);
		}
	}

	async function updateUnplacedText(work: UnplacedWork, text: string): Promise<void> {
		try {
			await ports.api.updateUnplacedWorkText(work.workId, text);
			await loadUnplacedWorks();
		} catch (cause) {
			report(cause);
		}
	}

	async function placeUnplaced(workId: string, parentId: string | null): Promise<void> {
		try {
			const created = await ports.api.placeUnplacedWork({ workId, parentId });
			await Promise.all([ports.reload(created.id), loadUnplacedWorks()]);
			ports.openView("outline");
			ports.selectOccurrence(created.id);
		} catch (cause) {
			report(cause);
		}
	}

	async function linkUnplaced(workId: string): Promise<void> {
		const targetId = unplacedLinkTargets[workId]?.trim();
		if (!targetId) return;
		try {
			const unplacedIsTarget = unplacedLinkDirections[workId] === "to";
			await ports.api.createLink({
				fromId: unplacedIsTarget ? targetId : workId,
				toId: unplacedIsTarget ? workId : targetId,
				type: unplacedLinkType,
			});
			unplacedLinkTargets = { ...unplacedLinkTargets, [workId]: "" };
			await ports.reload();
		} catch (cause) {
			report(cause);
		}
	}

	async function loadStubs(): Promise<void> {
		stubEntries = await ports.api.listStubs();
	}

	async function openStubs(): Promise<void> {
		try {
			await loadStubs();
			ports.openView("stubs");
		} catch (cause) {
			report(cause);
		}
	}

	async function createStubFromList(): Promise<void> {
		try {
			await ports.api.createStub("stub-list");
			await loadStubs();
		} catch (cause) {
			report(cause);
		}
	}

	async function updateStubText(entry: StubListEntry, text: string): Promise<void> {
		if (!text.trim() || text === entry.text) return;
		try {
			await ports.api.updateUnplacedWorkText(entry.workId, text);
			await loadStubs();
		} catch (cause) {
			report(cause);
		}
	}

	async function resolveStubEntry(workId: string): Promise<void> {
		try {
			await ports.api.resolveStub(workId);
			await Promise.all([loadStubs(), loadUnplacedWorks()]);
		} catch (cause) {
			report(cause);
		}
	}

	async function loadDuplicates(): Promise<void> {
		const candidates = await ports.api.listDuplicateCandidates();
		duplicateCandidates = candidates.filter((candidate) =>
			!excludedDuplicateCandidateKeys.includes(duplicateCandidateKey(candidate))
		);
	}

	async function openDuplicates(): Promise<void> {
		try {
			await loadDuplicates();
			ports.openView("duplicates");
		} catch (cause) {
			report(cause);
		}
	}

	function excludeDuplicateCandidate(candidate: DuplicateCandidate): void {
		const key = duplicateCandidateKey(candidate);
		if (!excludedDuplicateCandidateKeys.includes(key)) {
			excludedDuplicateCandidateKeys = [...excludedDuplicateCandidateKeys, key];
		}
		duplicateCandidates = duplicateCandidates.filter((entry) =>
			duplicateCandidateKey(entry) !== key
		);
	}

	async function createDuplicateCandidateLink(
		candidate: DuplicateCandidate,
		type: "LIKE" | "RELATED",
	): Promise<void> {
		try {
			await ports.api.createLink({
				fromId: candidate.workA.workId,
				toId: candidate.workB.workId,
				type,
				origin: "human",
				status: "asserted",
				reason: duplicateCandidateReason(candidate),
			});
			excludeDuplicateCandidate(candidate);
			await ports.reload();
		} catch (cause) {
			report(cause);
		}
	}

	async function requestDuplicateMerge(
		sourceWorkId: string,
		survivorWorkId: string,
	): Promise<void> {
		try {
			const preview = await ports.api.previewWorkMerge(sourceWorkId, survivorWorkId);
			await ports.requestConfirmation({ action: "merge-duplicate", preview });
		} catch (cause) {
			report(cause);
		}
	}

	async function loadTrash(): Promise<void> {
		trashEntries = await ports.api.listTrash();
	}

	async function openTrash(): Promise<void> {
		try {
			await loadTrash();
			ports.openView("trash");
		} catch (cause) {
			report(cause);
		}
	}

	async function restoreTrash(workId: string): Promise<void> {
		try {
			await ports.api.restoreWork(workId);
			await Promise.all([loadTrash(), ports.reload()]);
		} catch (cause) {
			report(cause);
		}
	}

	async function trashOccurrence(occurrenceId: string): Promise<void> {
		const item = ports.getSnapshot().items.find((candidate) => candidate.id === occurrenceId);
		if (!item) return;
		const occurrenceCount =
			ports.getSnapshot().items.filter((candidate) => candidate.workId === item.workId).length;
		await ports.requestConfirmation({ action: "trash", occurrenceId, occurrenceCount });
	}

	async function purgeTrash(entry: TrashEntry): Promise<void> {
		await ports.requestConfirmation({
			action: "purge",
			workId: entry.work.id,
			occurrenceCount: entry.occurrenceCount,
			linkCount: entry.linkCount,
		});
	}

	async function confirmTrash(occurrenceId: string): Promise<void> {
		await ports.api.trashWork(occurrenceId);
		ports.selectOccurrence(null);
		await ports.reload();
	}

	async function confirmPurge(workId: string): Promise<void> {
		await ports.api.purgeWork(workId);
		await Promise.all([loadTrash(), ports.reloadBookmarks?.()]);
	}

	async function confirmDuplicateMerge(preview: WorkMergePreview): Promise<void> {
		await ports.api.mergeWorks(preview);
		await Promise.all([ports.reload(), loadDuplicates()]);
	}

	return {
		get quickCaptureSubmitting() {
			return quickCaptureSubmitting;
		},
		get unplacedWorks() {
			return unplacedWorks;
		},
		get stubEntries() {
			return stubEntries;
		},
		get duplicateCandidates() {
			return duplicateCandidates;
		},
		get excludedDuplicateCandidateKeys() {
			return excludedDuplicateCandidateKeys;
		},
		get unplacedLinkTargets() {
			return unplacedLinkTargets;
		},
		set unplacedLinkTargets(value: Record<string, string>) {
			unplacedLinkTargets = value;
		},
		get unplacedLinkDirections() {
			return unplacedLinkDirections;
		},
		set unplacedLinkDirections(value: Record<string, UnplacedLinkDirection>) {
			unplacedLinkDirections = value;
		},
		get unplacedLinkType() {
			return unplacedLinkType;
		},
		set unplacedLinkType(value: LinkType) {
			unplacedLinkType = value;
		},
		get trashEntries() {
			return trashEntries;
		},
		performQuickCapture,
		loadUnplacedWorks,
		openUnplaced,
		updateUnplacedText,
		placeUnplaced,
		linkUnplaced,
		loadStubs,
		openStubs,
		createStubFromList,
		updateStubText,
		resolveStubEntry,
		loadDuplicates,
		openDuplicates,
		excludeDuplicateCandidate,
		duplicateCandidateKey,
		duplicateCandidateReason,
		createDuplicateCandidateLink,
		requestDuplicateMerge,
		loadTrash,
		openTrash,
		restoreTrash,
		trashOccurrence,
		purgeTrash,
		confirmTrash,
		confirmPurge,
		confirmDuplicateMerge,
	};
}
