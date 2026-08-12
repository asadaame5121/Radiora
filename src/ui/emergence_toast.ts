import type { EmergenceSuggestion } from "../domain/models.ts";

export interface EmergenceToastContent {
	title: string;
	message: string;
}

export function emergenceToastContent(
	suggestions: readonly EmergenceSuggestion[],
	titleForId: (id: string) => string,
): EmergenceToastContent | null {
	const first = suggestions[0];
	if (!first) return null;
	const remainder = suggestions.length - 1;
	return {
		title: "新しい関係候補",
		message: remainder
			? `${titleForId(first.targetItemId)} ほか${remainder}件の候補が見つかりました。`
			: `${titleForId(first.targetItemId)}との関係候補が見つかりました。`,
	};
}
