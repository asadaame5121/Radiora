import type { LinkType, OutlineSnapshot } from "../domain/models.ts";
import type { RadioraBindings } from "../shared/bindings.ts";

export type EditorCompletionPorts = {
	api: Pick<RadioraBindings, "listInternalReferenceCompletions" | "quickCapture" | "createLink">;
	getSnapshot(): OutlineSnapshot;
	getSelectedId(): string | null;
	reload(focusId?: string): Promise<unknown>;
	loadUnplacedWorks(): Promise<void>;
	requestFocus(itemId: string, caretOffset?: number): void;
	findTextarea(itemId: string): HTMLTextAreaElement | null;
	reportError(cause: unknown): void;
	relationTypeNames?: () => readonly LinkType[];
	isSymmetricRelationType?: (type: LinkType) => boolean;
	vocabulary: { work: string; semanticLink: string };
};
