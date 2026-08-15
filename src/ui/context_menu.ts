/** A single actionable entry in the shared application context menu. */
export interface ContextMenuItem {
	readonly id: string;
	readonly label: string;
	readonly disabled?: boolean;
	readonly reason?: string;
	readonly danger?: boolean;
	readonly separatorBefore?: boolean;
}
