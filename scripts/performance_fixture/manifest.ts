import { isSymmetricLinkType, type Occurrence } from "../../src/domain/models.ts";
import {
	type GraphStateSnapshot,
	validatedGraphStateSnapshot,
} from "../../src/storage/graph_store.ts";
import {
	BASE_TREE_MAX_DEPTH,
	DENSE_HUB_DEGREE_DIVISOR,
	FIXTURE_VERSION,
	LINK_COUNT_PER_TOPIC,
	parseProfile,
	parseSeed,
	parseTopicCount,
	SAMPLE_RANDOM_SALT,
} from "./model.ts";
import type {
	PerformanceFixture,
	PerformanceFixtureManifest,
	PerformanceFixtureOptions,
} from "./model.ts";
import { createRandom } from "./random.ts";

export function validatePerformanceFixture(value: unknown): PerformanceFixture {
	if (!isRecord(value) || !isRecord(value.manifest)) {
		throw new Error("Performance fixture must contain manifest and state objects.");
	}
	const manifest = value.manifest;
	const options = {
		profile: parseProfile(manifest.profile),
		topicCount: parseTopicCount(manifest.topicCount),
		seed: parseSeed(manifest.seed),
	};
	if (manifest.fixtureVersion !== FIXTURE_VERSION) {
		throw new Error(`Unsupported performance fixture version: ${String(manifest.fixtureVersion)}`);
	}
	const state = validatedGraphStateSnapshot(value.state);
	const measured = measureFixture(state, options);
	validateProfileShape(measured);
	if (
		manifest.rootCount !== measured.rootCount ||
		manifest.linkCount !== measured.linkCount ||
		manifest.maximumDepth !== measured.maximumDepth ||
		manifest.totalTextBytes !== measured.totalTextBytes
	) {
		throw new Error("Performance fixture manifest does not match its graph state.");
	}
	return { manifest: measured, state };
}

export function measureFixture(
	state: GraphStateSnapshot,
	options: PerformanceFixtureOptions,
): PerformanceFixtureManifest {
	const workIds = new Set(state.works.map((work) => work.id));
	const occurrenceById = new Map(
		state.occurrences.map((occurrence) => [occurrence.id, occurrence]),
	);
	if (
		state.works.length !== options.topicCount ||
		state.workingCopies.length !== options.topicCount ||
		state.occurrences.length !== options.topicCount ||
		state.branches.length !== options.topicCount
	) {
		throw new Error("Performance fixture topic collections do not match topicCount.");
	}
	const topology = measureTopology(state.occurrences, occurrenceById);
	const links = measureLinks(state.links, workIds);
	const text = measureWorkingCopies(state.workingCopies, workIds);
	const sampleRandom = createRandom(options.seed, SAMPLE_RANDOM_SALT);
	const randomOccurrenceIds: string[] = [];
	const sampleIndices = new Set<number>();
	while (randomOccurrenceIds.length < 5) {
		const index = Math.floor(sampleRandom() * state.occurrences.length);
		if (sampleIndices.has(index)) continue;
		sampleIndices.add(index);
		randomOccurrenceIds.push(state.occurrences[index].id);
	}
	return {
		fixtureVersion: FIXTURE_VERSION,
		...options,
		rootCount: topology.rootCount,
		maximumDepth: topology.maximumDepth,
		depthDistribution: topology.depthDistribution,
		childCountDistribution: topology.childCountDistribution,
		linkCount: state.links.length,
		uniqueAdjacentTopics: links.uniqueAdjacentTopics,
		maximumDegree: links.maximumDegree,
		totalBodyCharacters: text.totalBodyCharacters,
		totalTextBytes: text.totalTextBytes,
		bodyLengthDistribution: text.bodyLengthDistribution,
		internalReferenceCount: text.internalReferenceCount,
		samples: {
			randomOccurrenceIds,
			deepestOccurrenceIds: topology.deepestOccurrenceIds,
			widestParentOccurrenceIds: topology.widestParentOccurrenceIds,
			highestDegreeWorkIds: links.highestDegreeWorkIds,
		},
	};
}

function measureTopology(
	occurrences: readonly Occurrence[],
	occurrenceById: ReadonlyMap<string, Occurrence>,
) {
	const rootCount = validateParentForest(occurrences, occurrenceById);
	if (rootCount < 80 || rootCount > 200) {
		throw new Error("Performance fixture rootCount is outside 80–200.");
	}
	const depthById = calculateDepths(occurrences, occurrenceById);
	const childCounts = countChildrenByParent(occurrences);
	return {
		rootCount,
		maximumDepth: Math.max(0, ...depthById.values()),
		depthDistribution: countDepths(depthById),
		childCountDistribution: countChildCounts(occurrences, childCounts),
		deepestOccurrenceIds: sortCounts(depthById)
			.slice(0, 5)
			.map(([id]) => id),
		widestParentOccurrenceIds: sortCounts(childCounts)
			.slice(0, 5)
			.map(([id]) => id),
	};
}

function countDepths(depthById: ReadonlyMap<string, number>): Record<string, number> {
	const distribution: Record<string, number> = {};
	for (const depth of depthById.values()) {
		const key = String(depth);
		distribution[key] = (distribution[key] ?? 0) + 1;
	}
	return distribution;
}

function countChildrenByParent(occurrences: readonly Occurrence[]): Map<string, number> {
	const childCounts = new Map<string, number>();
	for (const occurrence of occurrences) {
		if (occurrence.parentOccurrenceId) {
			childCounts.set(
				occurrence.parentOccurrenceId,
				(childCounts.get(occurrence.parentOccurrenceId) ?? 0) + 1,
			);
		}
	}
	return childCounts;
}

function countChildCounts(
	occurrences: readonly Occurrence[],
	childCounts: ReadonlyMap<string, number>,
) {
	const distribution = {
		leaf: 0,
		oneToFive: 0,
		sixToTwenty: 0,
		twentyOneToHundred: 0,
		hundredOneToThreeHundred: 0,
		overThreeHundred: 0,
		maximum: 0,
	};
	for (const occurrence of occurrences) {
		const count = childCounts.get(occurrence.id) ?? 0;
		distribution[childCountBucket(count)] += 1;
		distribution.maximum = Math.max(distribution.maximum, count);
	}
	return distribution;
}

function childCountBucket(
	count: number,
):
	| "leaf"
	| "oneToFive"
	| "sixToTwenty"
	| "twentyOneToHundred"
	| "hundredOneToThreeHundred"
	| "overThreeHundred" {
	if (count === 0) return "leaf";
	if (count <= 5) return "oneToFive";
	if (count <= 20) return "sixToTwenty";
	if (count <= 100) return "twentyOneToHundred";
	if (count <= 300) return "hundredOneToThreeHundred";
	return "overThreeHundred";
}

function measureLinks(links: GraphStateSnapshot["links"], workIds: ReadonlySet<string>) {
	const degree = new Map<string, number>();
	const adjacent = new Set<string>();
	const pairKeys = new Set<string>();
	for (const link of links) {
		if (
			link.from.scope !== "work" ||
			link.to.scope !== "work" ||
			!workIds.has(link.from.workId) ||
			!workIds.has(link.to.workId) ||
			link.from.workId === link.to.workId
		)
			throw new Error(`Performance fixture has invalid link endpoints: ${link.id}`);
		const [left, right] = isSymmetricLinkType(link.type)
			? [link.from.workId, link.to.workId].sort()
			: [link.from.workId, link.to.workId];
		const key = `${link.type}:${left}:${right}`;
		if (pairKeys.has(key)) throw new Error(`Performance fixture has a duplicate link: ${link.id}`);
		pairKeys.add(key);
		adjacent.add(link.from.workId);
		adjacent.add(link.to.workId);
		degree.set(link.from.workId, (degree.get(link.from.workId) ?? 0) + 1);
		degree.set(link.to.workId, (degree.get(link.to.workId) ?? 0) + 1);
	}
	return {
		uniqueAdjacentTopics: adjacent.size,
		maximumDegree: Math.max(0, ...degree.values()),
		highestDegreeWorkIds: sortCounts(degree)
			.slice(0, 5)
			.map(([id]) => id),
	};
}

function measureWorkingCopies(
	copies: GraphStateSnapshot["workingCopies"],
	workIds: ReadonlySet<string>,
) {
	let totalBodyCharacters = 0;
	let totalTextBytes = 0;
	let internalReferenceCount = 0;
	const bodyLengthDistribution = { empty: 0, short: 0, medium: 0, long: 0 };
	const encoder = new TextEncoder();
	for (const copy of copies) {
		const separator = copy.text.indexOf("\n\n");
		const body = separator < 0 ? "" : copy.text.slice(separator + 2);
		const bodyLength = body.length;
		totalBodyCharacters += bodyLength;
		totalTextBytes += encoder.encode(copy.text).byteLength;
		if (bodyLength === 0) bodyLengthDistribution.empty += 1;
		else if (bodyLength <= 200) bodyLengthDistribution.short += 1;
		else if (bodyLength <= 2_000) bodyLengthDistribution.medium += 1;
		else bodyLengthDistribution.long += 1;
		internalReferenceCount += countInternalReferences(copy.text, workIds);
	}
	return { totalBodyCharacters, totalTextBytes, bodyLengthDistribution, internalReferenceCount };
}

function countInternalReferences(text: string, workIds: ReadonlySet<string>): number {
	if (!text.includes("radiora://work/")) return 0;
	const references = parseInternalWorkReferences(text);
	for (const reference of references) {
		if (!workIds.has(reference)) {
			throw new Error(`Internal reference target not found: ${reference}`);
		}
	}
	return references.length;
}

function sortCounts(counts: ReadonlyMap<string, number>): Array<[string, number]> {
	return [...counts.entries()].sort(
		(left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
	);
}

function validateParentForest(
	occurrences: readonly Occurrence[],
	occurrenceById: ReadonlyMap<string, Occurrence>,
): number {
	const ids = new Set(occurrences.map((occurrence) => occurrence.id));
	let rootCount = 0;
	for (const occurrence of occurrences) {
		const parentId = occurrence.parentOccurrenceId;
		if (parentId === null) {
			rootCount += 1;
			continue;
		}
		if (parentId === occurrence.id || !ids.has(parentId)) {
			throw new Error(`Invalid parent reference: ${occurrence.id}`);
		}
	}
	assertAcyclicParents(occurrences, occurrenceById);
	return rootCount;
}

function assertAcyclicParents(
	occurrences: readonly Occurrence[],
	occurrenceById: ReadonlyMap<string, Occurrence>,
): void {
	const resolved = new Set<string>();
	for (const occurrence of occurrences) {
		const path: string[] = [];
		let cursor: string | null = occurrence.id;
		const pathSet = new Set<string>();
		while (cursor !== null && !resolved.has(cursor)) {
			if (pathSet.has(cursor)) throw new Error(`Parent cycle detected at occurrence: ${cursor}`);
			pathSet.add(cursor);
			path.push(cursor);
			cursor = occurrenceById.get(cursor)?.parentOccurrenceId ?? null;
		}
		for (const id of path) resolved.add(id);
	}
}

function calculateDepths(
	occurrences: readonly Occurrence[],
	occurrenceById: ReadonlyMap<string, Occurrence>,
): Map<string, number> {
	const depths = new Map<string, number>();
	for (const occurrence of occurrences) {
		if (depths.has(occurrence.id)) continue;
		const path: string[] = [];
		let cursor: string | null = occurrence.id;
		while (cursor !== null && !depths.has(cursor)) {
			path.push(cursor);
			cursor = occurrenceById.get(cursor)?.parentOccurrenceId ?? null;
		}
		let depth = cursor === null ? -1 : (depths.get(cursor) ?? -1);
		for (const id of path.reverse()) {
			depth += 1;
			depths.set(id, depth);
		}
	}
	return depths;
}

function parseInternalWorkReferences(text: string): string[] {
	const pattern = /\]\(radiora:\/\/work\/([0-9a-f-]+)\)/g;
	return [...text.matchAll(pattern)].map((match) => match[1]);
}

export function validateProfileShape(manifest: PerformanceFixtureManifest): void {
	const { profile, topicCount } = manifest;
	const requiresDeep = profile === "deep-tree" || profile === "combined";
	const requiresWide = profile === "wide-tree" || profile === "combined";
	const requiresDense = profile === "dense-links" || profile === "combined";
	if (requiresDeep && manifest.maximumDepth < Math.max(50, Math.floor(topicCount * 0.0128))) {
		throw new Error(`Profile ${profile} is missing its deep branch.`);
	}
	if (!requiresDeep && manifest.maximumDepth > BASE_TREE_MAX_DEPTH) {
		throw new Error(`Profile ${profile} exceeds the shallow-tree depth limit.`);
	}
	if (requiresWide && manifest.childCountDistribution.maximum < Math.floor(topicCount * 0.1)) {
		throw new Error(`Profile ${profile} is missing a wide parent.`);
	}
	if (
		requiresDense &&
		manifest.maximumDegree < Math.max(100, Math.floor(topicCount / DENSE_HUB_DEGREE_DIVISOR))
	)
		throw new Error(`Profile ${profile} is missing its high-degree link hubs.`);
	if (manifest.linkCount !== topicCount * LINK_COUNT_PER_TOPIC) {
		throw new Error(`Profile ${profile} has an unexpected link count.`);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
