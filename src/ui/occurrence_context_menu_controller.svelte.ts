import { type CommandId, isEditableTarget } from "./command_service.ts";
export interface OccurrenceContextMenuState {
	targetId: string;
	source: "outline" | "tree";
	x: number;
	y: number;
	triggerElement: HTMLElement | SVGElement | null;
}
interface ContextMenuPorts {
	exists(id: string): boolean;
	select(id: string): boolean;
	selected(): string | null;
	execute(id: CommandId): Promise<void>;
	remove(id: string): Promise<void>;
	navigate(id: string, kind: "open-outline" | "zoom" | "work-lineage"): Promise<unknown>;
	actions: Record<string, (targetId: string) => Promise<unknown>>;
	run(action: () => Promise<unknown>): Promise<void>;
}
const COMMAND_ACTIONS: Record<string, CommandId> = {
	"long-form": "startLongFormEditing",
	"create-link": "createLink",
	"create-branch": "createBranch",
};
const MENU_FALLBACK_POSITION = 8;

export class OccurrenceContextMenuController {
	private menu = $state<OccurrenceContextMenuState | null>(null);
	constructor(private readonly ports: ContextMenuPorts) {}
	get state() {
		return this.menu;
	}
	close = (): void => {
		this.menu = null;
	};
	open(id: string, source: "outline" | "tree", event: MouseEvent | KeyboardEvent): void {
		if (!this.ports.exists(id) || (source === "outline" && isEditableTarget(event.target))) return;
		event.preventDefault();
		if (!this.ports.select(id)) return;
		const triggerElement =
			event.currentTarget instanceof HTMLElement || event.currentTarget instanceof SVGElement
				? event.currentTarget
				: null;
		const rect = triggerElement?.getBoundingClientRect();
		this.menu = {
			targetId: id,
			source,
			x: event instanceof MouseEvent ? event.clientX : rect?.left ?? MENU_FALLBACK_POSITION,
			y: event instanceof MouseEvent ? event.clientY : rect?.bottom ?? MENU_FALLBACK_POSITION,
			triggerElement,
		};
	}
	keydown(id: string, source: "outline" | "tree", event: KeyboardEvent): void {
		if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
			this.open(id, source, event);
		}
	}
	execute = async (action: string): Promise<void> => {
		const targetId = this.menu?.targetId;
		if (!targetId || !this.ports.exists(targetId)) return;
		if (action === "open-outline" || action === "zoom" || action === "work-lineage") {
			await this.ports.run(() => this.ports.navigate(targetId, action));
			return;
		}
		if (this.ports.selected() !== targetId) return;
		// Menu removal is available in Tree too; keyboard removal keeps its Outline-only guard.
		if (action === "remove-occurrence") {
			await this.ports.run(() => this.ports.remove(targetId));
			return;
		}
		const command = COMMAND_ACTIONS[action];
		if (command) await this.ports.execute(command);
		else if (this.ports.actions[action]) await this.ports.actions[action](targetId);
	};
}
