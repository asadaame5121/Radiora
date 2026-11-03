import { expect, test } from "vitest";
import type { EmergenceSuggestion } from "../../../src/domain/models.ts";
import { emergenceToastContent } from "../../../src/ui/emergence_toast.ts";

function suggestion(id: string, targetItemId: string): EmergenceSuggestion {
	return {
		id,
		kind: "latent-relation",
		contextWorkId: "context-work",
		targetWorkId: `work-${targetItemId}`,
		contextItemId: "context-item",
		targetItemId,
		proposedLinkType: "LIKE",
		title: "候補",
		explanation: "根拠",
		evidence: [],
		score: 0.8,
		persistenceStatus: "pending",
		createdAt: "2026-08-10T00:00:00.000Z",
		updatedAt: "2026-08-10T00:00:00.000Z",
	};
}

test("emergence toast summarizes unseen suggestions for one context", () => {
	expect(
		emergenceToastContent(
			[suggestion("one", "target-a")],
			(id) => ({ "target-a": "Alpha" })[id] ?? id,
		),
	).toEqual({
		title: "新しい関係候補",
		message: "Alphaとの関係候補が見つかりました。",
	});
	expect(
		emergenceToastContent(
			[suggestion("one", "target-a"), suggestion("two", "target-b")],
			(id) => ({ "target-a": "Alpha", "target-b": "Beta" })[id] ?? id,
		),
	).toEqual({
		title: "新しい関係候補",
		message: "Alpha ほか1件の候補が見つかりました。",
	});
	expect(emergenceToastContent([], (id) => id)).toEqual(null);
});
