import { canonicalInternalReferenceMarkdown } from "../../src/services/internal_reference.ts";
import type { LinkType, Occurrence, OutlineLink } from "../../src/domain/models.ts";
import { isSymmetricLinkType, LINK_TYPES } from "../../src/domain/models.ts";
import { BUILT_IN_RELATION_TYPES } from "../../src/domain/relation_type.ts";
import {
	type GraphStateSnapshot,
	validatedGraphStateSnapshot,
} from "../../src/storage/graph_store.ts";
import {
	BASE_TREE_MAX_DEPTH,
	DENSE_HUB_DEGREE_DIVISOR,
	FIXTURE_BASE_TIME,
	FIXTURE_TIME_STEP_MS,
	LINK_COUNT_PER_TOPIC,
	LINK_RANDOM_SALT,
	parseProfile,
	parseSeed,
	parseTopicCount,
	TEXT_RANDOM_SALT,
	TREE_RANDOM_SALT,
} from "./model.ts";
import type { PerformanceFixture, PerformanceFixtureOptions } from "./model.ts";
import { createRandom } from "./random.ts";
import { measureFixture, validateProfileShape } from "./manifest.ts";
import { FIXTURE_LINK_TYPE, fixtureId, fixtureTimestamp, makeLink } from "./entities.ts";

interface ParentLayout {
	parentIndices: Array<number | null>;
	depths: number[];
	rootCount: number;
}

interface LinkPair {
	fromIndex: number;
	toIndex: number;
}

const LINK_TYPE: LinkType = FIXTURE_LINK_TYPE;

export function createPerformanceFixture(input: PerformanceFixtureOptions): PerformanceFixture {
	const options = normalizeOptions(input);
	const works = Array.from({ length: options.topicCount }, (_, index) => ({
		id: fixtureId(options.seed, 1, index),
		createdAt: fixtureTimestamp(index),
		updatedAt: fixtureTimestamp(index),
	}));
	const workIds = works.map((work) => work.id);
	const layout = buildParentLayout(options, createRandom(options.seed, TREE_RANDOM_SALT));
	const occurrences = buildOccurrences(options.seed, workIds, layout);
	const workingCopies = buildWorkingCopies(options, workIds);
	const linkPairs = buildLinkPairs(
		options,
		layout.rootCount,
		createRandom(options.seed, LINK_RANDOM_SALT),
	);
	const links = linkPairs.map(({ fromIndex, toIndex }, index) =>
		makeLink(options.seed, index, workIds[fromIndex], workIds[toIndex])
	);
	const state = validatedGraphStateSnapshot({
		works,
		branches: works.map((work, index) => ({
			id: fixtureId(options.seed, 2, index),
			workId: work.id,
			name: "main",
			headRevisionId: null,
			createdAt: work.createdAt,
		})),
		workingCopies,
		occurrences,
		links,
		systemRelations: [],
		knots: [],
		aliases: [],
		emergenceFeedback: {},
		emergenceSuggestions: [],
		savedRuleQueries: [],
		purgeManifests: [],
		revisions: [],
		recoverySnapshots: [],
		bookmarks: [],
		resumePosition: null,
		relationTypeDefinitions: BUILT_IN_RELATION_TYPES.map((definition) => ({ ...definition })),
	});
	const manifest = measureFixture(state, options);
	validateProfileShape(manifest);
	return { manifest, state };
}

function buildParentLayout(
	options: PerformanceFixtureOptions,
	random: () => number,
): ParentLayout {
	const { topicCount, profile } = options;
	const rootCount = Math.max(80, Math.min(200, Math.floor(topicCount / 80)));
	const parentIndices: Array<number | null> = Array(rootCount).fill(null);
	const depths = Array<number>(rootCount).fill(0);
	const rootByIndex = Array.from({ length: rootCount }, (_, index) => index);
	const candidatesByRoot = rootByIndex.map((root) => [root]);
	let nextIndex = rootCount;
	const usesDeepTree = profile === "deep-tree" || profile === "combined";
	const usesWideTree = profile === "wide-tree" || profile === "combined";
	const deepLength = usesDeepTree
		? Math.min(150, Math.max(50, Math.floor(topicCount * 0.0128)))
		: 0;

	for (let offset = 0; offset < deepLength; offset += 1) {
		const parent = offset === 0 ? 0 : nextIndex - 1;
		assignParent(nextIndex, parent, 0);
		nextIndex += 1;
	}

	const wideRoots = usesWideTree
		? [rootCount - 4, rootCount - 3, rootCount - 2, rootCount - 1]
		: [];
	const widthFractions = [0.03, 0.05, 0.075, 0.1];
	for (const [hubIndex, rootIndex] of wideRoots.entries()) {
		const directChildren = Math.floor(topicCount * widthFractions[hubIndex]);
		for (let child = 0; child < directChildren && nextIndex < topicCount; child += 1) {
			assignParent(nextIndex, rootIndex, rootIndex);
			nextIndex += 1;
		}
	}

	const excludedRoots = new Set(wideRoots);
	if (usesDeepTree) excludedRoots.add(0);
	const availableRoots = rootByIndex.filter((root) => !excludedRoots.has(root));
	if (availableRoots.length === 0) {
		throw new Error("Fixture has no roots available for remaining topics.");
	}

	let assignment = 0;
	while (nextIndex < topicCount) {
		const rootIndex = availableRoots[assignment % availableRoots.length];
		const candidates = candidatesByRoot[rootIndex];
		const parentIndex = candidates[Math.floor(random() * candidates.length)];
		assignParent(nextIndex, parentIndex, rootIndex);
		nextIndex += 1;
		assignment += 1;
	}

	return { parentIndices, depths, rootCount };

	function assignParent(index: number, parentIndex: number, rootIndex: number): void {
		parentIndices[index] = parentIndex;
		depths[index] = depths[parentIndex] + 1;
		if (depths[index] < BASE_TREE_MAX_DEPTH) candidatesByRoot[rootIndex].push(index);
	}
}

function buildOccurrences(
	seed: number,
	workIds: readonly string[],
	layout: ParentLayout,
): Occurrence[] {
	const nextOrder = new Map<string, number>();
	return workIds.map((workId, index) => {
		const parentIndex = layout.parentIndices[index];
		const parentId = parentIndex === null ? null : fixtureId(seed, 3, parentIndex);
		const siblingKey = parentId ?? "root";
		const orderKey = (nextOrder.get(siblingKey) ?? 0) + 1;
		nextOrder.set(siblingKey, orderKey);
		return {
			id: fixtureId(seed, 3, index),
			workId,
			parentOccurrenceId: parentId,
			orderKey,
			collapsed: false,
			revisionSelector: { mode: "branch", branchId: fixtureId(seed, 2, index) },
		};
	});
}

function buildWorkingCopies(
	options: PerformanceFixtureOptions,
	workIds: readonly string[],
): GraphStateSnapshot["workingCopies"] {
	const random = createRandom(options.seed, TEXT_RANDOM_SALT);
	return workIds.map((workId, index) => {
		const bodyLength = workingCopyBodyLength(index % 100, random);
		const internalReference = buildInternalReference(workIds, index, bodyLength);
		return {
			branchId: fixtureId(options.seed, 2, index),
			workId,
			text: workingCopyText(options.seed, index, bodyLength, internalReference),
			updatedAt: fixtureTimestamp(index),
		};
	});
}

function workingCopyBodyLength(bucket: number, random: () => number): number {
	if (bucket < 5) return 0;
	if (bucket < 40) return 32 + Math.floor(random() * 96);
	if (bucket === 99) return 10_000;
	return 200 + Math.floor(random() * 1_801);
}

function buildInternalReference(
	workIds: readonly string[],
	index: number,
	bodyLength: number,
): string {
	if (bodyLength <= 120 || index % 97 !== 0) return "";
	const targetIndex = (index + 17) % workIds.length;
	return `Related: ${
		canonicalInternalReferenceMarkdown(
			`Topic ${targetIndex.toString().padStart(5, "0")}`,
			"work",
			workIds[targetIndex],
		)
	}`;
}

function workingCopyText(
	seed: number,
	index: number,
	bodyLength: number,
	internalReference: string,
): string {
	const textBodyLength = Math.max(
		0,
		bodyLength - (internalReference ? internalReference.length + 1 : 0),
	);
	const phrase = `Seed ${seed} topic ${index} records a thought with evidence and context. `;
	const textBody = phrase.repeat(Math.ceil(textBodyLength / phrase.length)).slice(
		0,
		textBodyLength,
	);
	const body = textBody || internalReference
		? `\n\n${textBody}${internalReference ? `\n${internalReference}` : ""}`
		: "";
	return `# Topic ${index.toString().padStart(5, "0")}${body}`;
}

function buildLinkPairs(
	options: PerformanceFixtureOptions,
	rootCount: number,
	random: () => number,
): LinkPair[] {
	const { topicCount, profile } = options;
	const targetCount = topicCount * LINK_COUNT_PER_TOPIC;
	const useDenseLinks = profile === "dense-links" || profile === "combined";
	const hubs = useDenseLinks ? [rootCount - 8, rootCount - 7, rootCount - 6, rootCount - 5] : [];
	const hubSet = new Set(hubs);
	const pairKeys = new Set<string>();
	const links: LinkPair[] = [];

	function add(fromIndex: number, toIndex: number): void {
		if (fromIndex === toIndex) return;
		const [left, right] = isSymmetricLinkType(LINK_TYPE)
			? [Math.min(fromIndex, toIndex), Math.max(fromIndex, toIndex)]
			: [fromIndex, toIndex];
		const key = `${LINK_TYPE}:${left}:${right}`;
		if (pairKeys.has(key)) return;
		pairKeys.add(key);
		links.push({ fromIndex, toIndex });
	}

	if (useDenseLinks) {
		const fanout = Math.min(
			Math.max(100, Math.floor(topicCount / DENSE_HUB_DEGREE_DIVISOR)),
			topicCount - hubs.length,
		);
		const targets = Array.from({ length: topicCount }, (_, index) => index)
			.filter((index) => !hubSet.has(index));
		shuffle(targets, random);
		for (const hub of hubs) {
			for (const target of targets.slice(0, fanout)) add(hub, target);
		}
	}
	const maxAttempts = targetCount * 100;
	let attempts = 0;
	while (links.length < targetCount && attempts < maxAttempts) {
		attempts += 1;
		const from = Math.floor(random() * topicCount);
		const to = Math.floor(random() * topicCount);
		if (useDenseLinks && (hubSet.has(from) || hubSet.has(to))) continue;
		add(from, to);
	}
	if (links.length !== targetCount) {
		throw new Error("Unable to generate the requested unique link count.");
	}
	return links;
}

function normalizeOptions(options: PerformanceFixtureOptions): PerformanceFixtureOptions {
	return {
		profile: parseProfile(options.profile),
		topicCount: parseTopicCount(options.topicCount),
		seed: parseSeed(options.seed),
	};
}

function shuffle(values: number[], random: () => number): void {
	for (let index = values.length - 1; index > 0; index -= 1) {
		const other = Math.floor(random() * (index + 1));
		[values[index], values[other]] = [values[other], values[index]];
	}
}
