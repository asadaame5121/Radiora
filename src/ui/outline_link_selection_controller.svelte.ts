import type { CreateLinkInput, LinkType } from "../domain/models.ts";
import { isSymmetricLinkType } from "../domain/models.ts";
import type { OutlineLinkSelectionDirection } from "./outline_row_types.ts";

export type OutlineLinkSelectionControllerPorts = {
	createLink: (input: CreateLinkInput) => Promise<void>;
};

/** Owns the temporary Work-level selection and its bulk link submission. */
export class OutlineLinkSelectionController {
	active = $state(false);
	originWorkId = $state<string | null>(null);
	originDisplayName = $state("");
	selectedWorkIds = $state<ReadonlySet<string>>(new Set());
	selectedType = $state<LinkType>("RELATED");
	direction = $state<OutlineLinkSelectionDirection>("outgoing");
	reason = $state("");
	submitting = $state(false);
	error = $state("");

	private readonly ports: OutlineLinkSelectionControllerPorts;

	constructor(ports: OutlineLinkSelectionControllerPorts) {
		this.ports = ports;
	}

	get selectedWorkCount(): number {
		return this.selectedWorkIds.size;
	}

	get canSubmit(): boolean {
		return this.active && !this.submitting && this.selectedWorkCount > 0;
	}

	start(originWorkId: string, originDisplayName: string): boolean {
		if (this.submitting || !originWorkId) return false;
		this.active = true;
		this.originWorkId = originWorkId;
		this.originDisplayName = originDisplayName;
		this.selectedWorkIds = new Set();
		this.selectedType = "RELATED";
		this.direction = "outgoing";
		this.reason = "";
		this.error = "";
		return true;
	}

	cancel(): boolean {
		if (!this.active || this.submitting) return false;
		this.clear();
		return true;
	}

	toggleTarget(workId: string): void {
		if (!this.active || this.submitting || !this.originWorkId || workId === this.originWorkId) {
			return;
		}
		const next = new Set(this.selectedWorkIds);
		if (next.has(workId)) next.delete(workId);
		else next.add(workId);
		this.selectedWorkIds = next;
		this.error = "";
	}

	setType(type: LinkType): void {
		if (!this.active || this.submitting) return;
		this.selectedType = type;
		this.error = "";
	}

	setDirection(direction: OutlineLinkSelectionDirection): void {
		if (!this.active || this.submitting || isSymmetricLinkType(this.selectedType)) return;
		this.direction = direction;
		this.error = "";
	}

	setReason(reason: string): void {
		if (!this.active || this.submitting) return;
		this.reason = reason;
		this.error = "";
	}

	async submit(): Promise<boolean> {
		if (!this.canSubmit || !this.originWorkId) return false;
		const originWorkId = this.originWorkId;
		const targetWorkIds = [...this.selectedWorkIds];
		const type = this.selectedType;
		const direction = isSymmetricLinkType(type) ? "outgoing" : this.direction;
		const reason = this.reason.trim() || undefined;

		this.submitting = true;
		this.error = "";
		try {
			for (const targetWorkId of targetWorkIds) {
				const input: CreateLinkInput = direction === "outgoing"
					? { fromId: originWorkId, toId: targetWorkId, type, reason }
					: { fromId: targetWorkId, toId: originWorkId, type, reason };
				await this.ports.createLink(input);
			}
			this.clear();
			return true;
		} catch (cause) {
			this.error = errorMessage(cause);
			return false;
		} finally {
			this.submitting = false;
		}
	}

	private clear(): void {
		this.active = false;
		this.originWorkId = null;
		this.originDisplayName = "";
		this.selectedWorkIds = new Set();
		this.selectedType = "RELATED";
		this.direction = "outgoing";
		this.reason = "";
		this.submitting = false;
		this.error = "";
	}
}

function errorMessage(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}
