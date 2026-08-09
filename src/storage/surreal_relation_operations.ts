import type { OutlineLink } from "../domain/models.ts";
import { isSymmetricLinkType } from "../domain/models.ts";

export function duplicateLinkIdsAfterMerge(
	links: readonly OutlineLink[],
	sourceWorkId: string,
	survivorWorkId: string,
): string[] {
	const seen = new Set<string>();
	const duplicates: string[] = [];
	for (const link of links) {
		if (link.status === "retracted") continue;
		const replace = (endpoint: OutlineLink["from"]) =>
			endpoint.workId === sourceWorkId ? { ...endpoint, workId: survivorWorkId } : endpoint;
		const from = replace(link.from);
		const to = replace(link.to);
		const endpointKey = (endpoint: typeof from) =>
			endpoint.scope === "revision"
				? `revision:${endpoint.workId}:${endpoint.revisionId}`
				: `work:${endpoint.workId}`;
		let left = endpointKey(from);
		let right = endpointKey(to);
		if (isSymmetricLinkType(link.type) && left > right) [left, right] = [right, left];
		const key = `${link.type}|${left}|${right}`;
		if (left === right || seen.has(key)) duplicates.push(link.id);
		else seen.add(key);
	}
	return duplicates;
}
