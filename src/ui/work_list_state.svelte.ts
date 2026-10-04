import type { TrashEntry, UnplacedWork } from "../domain/models.ts";
import type { DuplicateCandidate } from "../services/duplicate_candidates.ts";
import type { StubListEntry } from "../services/stub_service.ts";
import type { WorkApiPort, WorkView } from "./work_controller.svelte.ts";

export function duplicateCandidateKey(candidate: DuplicateCandidate): string {
	return [candidate.workA.workId, candidate.workB.workId].sort().join(":");
}

export function duplicateCandidateReason(candidate: DuplicateCandidate): string {
	return candidate.reasons.map((reason) => reason.label).join(" / ");
}

/** Work list state owns reads and synchronous publication for navigation and mutation refreshes. */
type WorkListApi = Pick<
	WorkApiPort,
	"listUnplacedWorks" | "listStubs" | "listDuplicateCandidates" | "listTrash"
>;

export function createWorkListState(api: WorkListApi) {
	return new WorkListState(api);
}

class WorkListState {
	constructor(private readonly api: WorkListApi) {}
	private _unplacedWorks = $state<UnplacedWork[]>([]);
	private _stubEntries = $state<StubListEntry[]>([]);
	private _duplicateCandidates = $state<DuplicateCandidate[]>([]);
	private _excludedDuplicateCandidateKeys = $state<string[]>([]);
	private _trashEntries = $state<TrashEntry[]>([]);

	prepareScreen = async (view: WorkView): Promise<() => void> => {
		switch (view) {
			case "unplaced": {
				const result = await this.api.listUnplacedWorks();
				return () => {
					this._unplacedWorks = result;
				};
			}
			case "stubs": {
				const result = await this.api.listStubs();
				return () => {
					this._stubEntries = result;
				};
			}
			case "duplicates": {
				const result = await this.api.listDuplicateCandidates();
				return () => {
					this._duplicateCandidates = result.filter((candidate) =>
						!this._excludedDuplicateCandidateKeys.includes(duplicateCandidateKey(candidate))
					);
				};
			}
			case "trash": {
				const result = await this.api.listTrash();
				return () => {
					this._trashEntries = result;
				};
			}
			default:
				return () => undefined;
		}
	};

	loadUnplacedWorks = async (current = () => true): Promise<void> => {
		const publish = await this.prepareScreen("unplaced");
		if (current()) publish();
	};
	loadStubs = async (): Promise<void> => {
		(await this.prepareScreen("stubs"))();
	};
	loadDuplicates = async (): Promise<void> => {
		(await this.prepareScreen("duplicates"))();
	};
	loadTrash = async (): Promise<void> => {
		(await this.prepareScreen("trash"))();
	};
	excludeDuplicateCandidate = (candidate: DuplicateCandidate): void => {
		const key = duplicateCandidateKey(candidate);
		if (!this._excludedDuplicateCandidateKeys.includes(key)) {
			this._excludedDuplicateCandidateKeys = [...this._excludedDuplicateCandidateKeys, key];
		}
		this._duplicateCandidates = this._duplicateCandidates.filter((entry) =>
			duplicateCandidateKey(entry) !== key
		);
	};
	get unplacedWorks() {
		return this._unplacedWorks;
	}
	get stubEntries() {
		return this._stubEntries;
	}
	get duplicateCandidates() {
		return this._duplicateCandidates;
	}
	get excludedDuplicateCandidateKeys() {
		return this._excludedDuplicateCandidateKeys;
	}
	get trashEntries() {
		return this._trashEntries;
	}
}
