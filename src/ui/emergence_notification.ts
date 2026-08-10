import type { EmergenceSuggestion } from "../domain/models.ts";

export interface EmergenceNotificationContent {
	title: string;
	body: string;
	tag: string;
}

export function emergenceNotificationContent(
	suggestions: readonly EmergenceSuggestion[],
	titleForId: (id: string) => string,
): EmergenceNotificationContent | null {
	const first = suggestions[0];
	if (!first) return null;
	const remainder = suggestions.length - 1;
	return {
		title: "新しい関係候補",
		body: remainder
			? `${titleForId(first.targetItemId)} ほか${remainder}件の候補が見つかりました。`
			: `${titleForId(first.targetItemId)}との関係候補が見つかりました。`,
		tag: `radiora-emergence:${first.contextWorkId}`,
	};
}
