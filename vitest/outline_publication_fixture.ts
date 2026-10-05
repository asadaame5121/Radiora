import type { OutlineSnapshot } from "../src/domain/models.ts";
import { OutlineController } from "../src/ui/outline_controller.svelte.ts";

/** Existing navigation fixtures keep their read model while using the production publication owner. */
export function outlinePublicationFixture(publish: (snapshot: OutlineSnapshot) => void) {
	const owner = new OutlineController({
		readOutline: async () => ({ items: [], links: [], knots: [], stashItemIds: [] }),
		prepareBookmarks: () => ({
			result: Promise.resolve(),
			publish: () => undefined,
			cancel: () => undefined,
		}),
		drafts: () => [],
		prepareTree: () => ({
			result: Promise.resolve(),
			publish: () => undefined,
			cancel: () => undefined,
		}),
		reconcileSelection: () => undefined,
		selectionReceipt: () => () => true,
		focus: () => undefined,
		persist: () => undefined,
		reportError: () => undefined,
		clearError: () => undefined,
	});
	return {
		invalidate: () => owner.invalidate(),
		begin: () => {
			const request = owner.begin();
			return {
				current: request.current,
				publish: (snapshot: OutlineSnapshot) => {
					if (!request.publish(snapshot)) return false;
					publish(snapshot);
					return true;
				},
			};
		},
	};
}
