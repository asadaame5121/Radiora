import { canonicalInternalReferenceMarkdown } from "../src/services/internal_reference.ts";
import type { LinkType, Occurrence, OutlineLink } from "../src/domain/models.ts";
import { isSymmetricLinkType, LINK_TYPES } from "../src/domain/models.ts";
import { BUILT_IN_RELATION_TYPES } from "../src/domain/relation_type.ts";
import {
	type GraphStateSnapshot,
	validatedGraphStateSnapshot,
} from "../src/storage/graph_store.ts";
import { SqliteGraphStore } from "../src/storage/sqlite_store.ts";

export const PERFORMANCE_FIXTURE_PROFILES = [
	"baseline",
	"deep-tree",
	"dense-links",
	"wide-tree",
	"combined",
] as const;
export const PERFORMANCE_TOPIC_COUNTS = [1_000, 10_000] as const;

export type PerformanceFixtureProfile = typeof PERFORMANCE_FIXTURE_PROFILES[number];
export type PerformanceTopicCount = typeof PERFORMANCE_TOPIC_COUNTS[number];

export interface PerformanceFixtureOptions {
	profile: PerformanceFixtureProfile;
	topicCount: PerformanceTopicCount;
	seed: number;
}

export interface PerformanceFixtureManifest extends PerformanceFixtureOptions {
	fixtureVersion: 1;
	rootCount: number;
	maximumDepth: number;
	depthDistribution: Record<string, number>;
	childCountDistribution: {
		leaf: number;
		oneToFive: number;
		sixToTwenty: number;
		twentyOneToHundred: number;
		hundredOneToThreeHundred: number;
		overThreeHundred: number;
		maximum: number;
	};
	linkCount: number;
	uniqueAdjacentTopics: number;
	maximumDegree: number;
	totalBodyCharacters: number;
	totalTextBytes: number;
	bodyLengthDistribution: {
		empty: number;
		short: number;
		medium: number;
		long: number;
	};
	internalReferenceCount: number;
	samples: {
		randomOccurrenceIds: string[];
		deepestOccurrenceIds: string[];
		widestParentOccurrenceIds: string[];
		highestDegreeWorkIds: string[];
	};
}

export interface PerformanceFixture {
	manifest: PerformanceFixtureManifest;
	state: GraphStateSnapshot;
}

interface ParentLayout {
	parentIndices: Array<number | null>;
	depths: number[];
	rootCount: number;
}

interface LinkPair {
	fromIndex: number;
	toIndex: number;
}

interface CliOptions extends PerformanceFixtureOptions {
	outputPath?: string;
	databasePath?: string;
	manifestPath?: string;
	validatePath?: string;
}

const FIXTURE_VERSION = 1;
const FIXTURE_BASE_TIME = Date.UTC(2025, 0, 1);
const FIXTURE_TIME_STEP_MS = 1_000;
const BASE_TREE_MAX_DEPTH = 8;
const LINK_COUNT_PER_TOPIC = 2;
const DENSE_HUB_DEGREE_DIVISOR = 40;
const TEXT_RANDOM_SALT = 0x6d2b79f5;
const RNG_STEP = 0x6d2b79f5;
const TREE_RANDOM_SALT = 0x1b873593;
const LINK_RANDOM_SALT = 0x85ebca6b;
const SAMPLE_RANDOM_SALT = 0xc2b2ae35;
const LINK_TYPE: LinkType = LINK_TYPES[0];

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

export async function writePerformanceDatabase(
	path: string,
	state: GraphStateSnapshot,
): Promise<number> {
	await assertFileDoesNotExist(path);
	await makeParentDirectory(path);
	const store = new SqliteGraphStore(path);
	try {
		await store.initialize();
		await store.restoreGraphState(state);
	} finally {
		await store.close();
	}
	return (await Deno.stat(path)).size;
}

async function runCli(args: string[]): Promise<void> {
	const options = parseCliOptions(args);
	if (options.validatePath) {
		const input: unknown = JSON.parse(await Deno.readTextFile(options.validatePath));
		console.log(JSON.stringify(validatePerformanceFixture(input).manifest, null, 2));
		return;
	}
	const outputs = [options.outputPath, options.databasePath, options.manifestPath].filter(
		(path): path is string => path !== undefined,
	);
	await Promise.all(outputs.map(assertFileDoesNotExist));
	const generationStarted = performance.now();
	const fixture = createPerformanceFixture(options);
	const generationMs = performance.now() - generationStarted;
	let databaseBytes: number | null = null;
	let databaseSeedMs: number | null = null;
	if (options.databasePath) {
		const started = performance.now();
		databaseBytes = await writePerformanceDatabase(options.databasePath, fixture.state);
		databaseSeedMs = performance.now() - started;
	}
	if (options.outputPath) {
		await writeNewJsonFile(options.outputPath, fixture);
	}
	const manifestPath = options.manifestPath;
	if (manifestPath) await writeNewJsonFile(manifestPath, fixture.manifest);
	console.log(JSON.stringify(
		{
			manifest: fixture.manifest,
			generationMs: roundMs(generationMs),
			databaseSeedMs: databaseSeedMs === null ? null : roundMs(databaseSeedMs),
			databaseBytes,
			databasePath: options.databasePath ?? null,
			outputPath: options.outputPath ?? null,
			manifestPath: options.manifestPath ?? null,
		},
		null,
		2,
	));
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
		const bucket = index % 100;
		const bodyLength = bucket < 5
			? 0
			: bucket < 40
			? 32 + Math.floor(random() * 96)
			: bucket === 99
			? 10_000
			: 200 + Math.floor(random() * 1_801);
		const targetIndex = (index + 17) % workIds.length;
		const internalReference = bodyLength > 120 && index % 97 === 0
			? `Related: ${
				canonicalInternalReferenceMarkdown(
					`Topic ${targetIndex.toString().padStart(5, "0")}`,
					"work",
					workIds[targetIndex],
				)
			}`
			: "";
		const textBodyLength = Math.max(
			0,
			bodyLength - (internalReference ? internalReference.length + 1 : 0),
		);
		const phrase =
			`Seed ${options.seed} topic ${index} records a thought with evidence and context. `;
		const textBody = phrase.repeat(Math.ceil(textBodyLength / phrase.length)).slice(
			0,
			textBodyLength,
		);
		const text = `# Topic ${index.toString().padStart(5, "0")}${
			textBody || internalReference
				? `\n\n${textBody}${internalReference ? `\n${internalReference}` : ""}`
				: ""
		}`;
		return {
			branchId: fixtureId(options.seed, 2, index),
			workId,
			text,
			updatedAt: fixtureTimestamp(index),
		};
	});
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

function measureFixture(
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
	const rootCount = validateParentForest(state.occurrences, occurrenceById);
	if (rootCount < 80 || rootCount > 200) {
		throw new Error("Performance fixture rootCount is outside 80–200.");
	}
	const depthById = calculateDepths(state.occurrences, occurrenceById);
	const depthDistribution: Record<string, number> = {};
	for (const depth of depthById.values()) {
		const key = String(depth);
		depthDistribution[key] = (depthDistribution[key] ?? 0) + 1;
	}
	const childCounts = new Map<string, number>();
	for (const occurrence of state.occurrences) {
		if (occurrence.parentOccurrenceId) {
			childCounts.set(
				occurrence.parentOccurrenceId,
				(childCounts.get(occurrence.parentOccurrenceId) ?? 0) + 1,
			);
		}
	}
	let maximumChildren = 0;
	const childCountDistribution = {
		leaf: 0,
		oneToFive: 0,
		sixToTwenty: 0,
		twentyOneToHundred: 0,
		hundredOneToThreeHundred: 0,
		overThreeHundred: 0,
		maximum: 0,
	};
	for (const occurrence of state.occurrences) {
		const count = childCounts.get(occurrence.id) ?? 0;
		maximumChildren = Math.max(maximumChildren, count);
		if (count === 0) childCountDistribution.leaf += 1;
		else if (count <= 5) childCountDistribution.oneToFive += 1;
		else if (count <= 20) childCountDistribution.sixToTwenty += 1;
		else if (count <= 100) childCountDistribution.twentyOneToHundred += 1;
		else if (count <= 300) childCountDistribution.hundredOneToThreeHundred += 1;
		else childCountDistribution.overThreeHundred += 1;
	}
	childCountDistribution.maximum = maximumChildren;

	const degree = new Map<string, number>();
	const adjacent = new Set<string>();
	const pairKeys = new Set<string>();
	for (const link of state.links) {
		if (
			link.from.scope !== "work" ||
			link.to.scope !== "work" ||
			!workIds.has(link.from.workId) ||
			!workIds.has(link.to.workId) ||
			link.from.workId === link.to.workId
		) throw new Error(`Performance fixture has invalid link endpoints: ${link.id}`);
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
	const maximumDegree = Math.max(0, ...degree.values());
	let totalBodyCharacters = 0;
	let totalTextBytes = 0;
	let internalReferenceCount = 0;
	const bodyLengthDistribution = { empty: 0, short: 0, medium: 0, long: 0 };
	const encoder = new TextEncoder();
	for (const copy of state.workingCopies) {
		const separator = copy.text.indexOf("\n\n");
		const body = separator < 0 ? "" : copy.text.slice(separator + 2);
		const bodyLength = body.length;
		totalBodyCharacters += bodyLength;
		totalTextBytes += encoder.encode(copy.text).byteLength;
		if (bodyLength === 0) bodyLengthDistribution.empty += 1;
		else if (bodyLength <= 200) bodyLengthDistribution.short += 1;
		else if (bodyLength <= 2_000) bodyLengthDistribution.medium += 1;
		else bodyLengthDistribution.long += 1;
		if (copy.text.includes("radiora://work/")) {
			for (const reference of parseInternalWorkReferences(copy.text)) {
				if (!workIds.has(reference)) {
					throw new Error(`Internal reference target not found: ${reference}`);
				}
				internalReferenceCount += 1;
			}
		}
	}
	const maximumDepth = Math.max(0, ...depthById.values());
	const childSorted = [...childCounts.entries()].sort((left, right) =>
		right[1] - left[1] || left[0].localeCompare(right[0])
	);
	const degreeSorted = [...degree.entries()].sort((left, right) =>
		right[1] - left[1] || left[0].localeCompare(right[0])
	);
	const depthSorted = [...depthById.entries()].sort((left, right) =>
		right[1] - left[1] || left[0].localeCompare(right[0])
	);
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
		rootCount,
		maximumDepth,
		depthDistribution,
		childCountDistribution,
		linkCount: state.links.length,
		uniqueAdjacentTopics: adjacent.size,
		maximumDegree,
		totalBodyCharacters,
		totalTextBytes,
		bodyLengthDistribution,
		internalReferenceCount,
		samples: {
			randomOccurrenceIds,
			deepestOccurrenceIds: depthSorted.slice(0, 5).map(([id]) => id),
			widestParentOccurrenceIds: childSorted.slice(0, 5).map(([id]) => id),
			highestDegreeWorkIds: degreeSorted.slice(0, 5).map(([id]) => id),
		},
	};
}

function validateParentForest(
	occurrences: readonly Occurrence[],
	occurrenceById: ReadonlyMap<string, Occurrence>,
): number {
	const ids = new Set(occurrences.map((occurrence) => occurrence.id));
	let rootCount = 0;
	for (const occurrence of occurrences) {
		const parentId = occurrence.parentOccurrenceId;
		if (parentId === null) rootCount += 1;
		else if (parentId === occurrence.id || !ids.has(parentId)) {
			throw new Error(`Invalid parent reference: ${occurrence.id}`);
		}
	}
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
	return rootCount;
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
		let depth = cursor === null ? -1 : depths.get(cursor)!;
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

function validateProfileShape(manifest: PerformanceFixtureManifest): void {
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
	) throw new Error(`Profile ${profile} is missing its high-degree link hubs.`);
	if (manifest.linkCount !== topicCount * LINK_COUNT_PER_TOPIC) {
		throw new Error(`Profile ${profile} has an unexpected link count.`);
	}
}

function normalizeOptions(options: PerformanceFixtureOptions): PerformanceFixtureOptions {
	return {
		profile: parseProfile(options.profile),
		topicCount: parseTopicCount(options.topicCount),
		seed: parseSeed(options.seed),
	};
}

function parseCliOptions(args: string[]): CliOptions {
	let profile: PerformanceFixtureProfile = "baseline";
	let topicCount: PerformanceTopicCount = 1_000;
	let seed = 42;
	let outputPath: string | undefined;
	let databasePath: string | undefined;
	let manifestPath: string | undefined;
	let validatePath: string | undefined;
	for (let index = 0; index < args.length; index += 1) {
		const [flag, inlineValue] = args[index].split("=", 2);
		const value = inlineValue ?? args[++index];
		if (flag === "--help" || flag === "-h") {
			printHelp();
			Deno.exit(0);
		}
		if (!value) throw new Error(`Missing value for ${flag}`);
		switch (flag) {
			case "--profile":
				profile = parseProfile(value);
				break;
			case "--topic-count":
				topicCount = parseTopicCount(Number(value));
				break;
			case "--seed":
				seed = parseSeed(Number(value));
				break;
			case "--output":
				outputPath = value;
				break;
			case "--database":
				databasePath = value;
				break;
			case "--manifest":
				manifestPath = value;
				break;
			case "--validate":
				validatePath = value;
				break;
			default:
				throw new Error(`Unknown option: ${flag}`);
		}
	}
	if (validatePath) {
		if (outputPath || databasePath || manifestPath) {
			throw new Error("--validate cannot be combined with output, database, or manifest paths.");
		}
	} else if (!outputPath && !databasePath) {
		throw new Error("Specify --output and/or --database for generated data.");
	}
	if (!validatePath && !manifestPath) {
		const primaryPath = databasePath ?? outputPath;
		if (!primaryPath) throw new Error("Specify --output and/or --database for generated data.");
		manifestPath = `${primaryPath}.manifest.json`;
	}
	const destinations = [outputPath, databasePath, manifestPath].filter(
		(path): path is string => path !== undefined,
	);
	if (new Set(destinations).size !== destinations.length) {
		throw new Error("Output, database, and manifest paths must be different.");
	}
	return { profile, topicCount, seed, outputPath, databasePath, manifestPath, validatePath };
}

function parseProfile(value: unknown): PerformanceFixtureProfile {
	if (value === "baseline") return "baseline";
	if (value === "deep-tree") return "deep-tree";
	if (value === "dense-links") return "dense-links";
	if (value === "wide-tree") return "wide-tree";
	if (value === "combined") return "combined";
	throw new Error(`Invalid performance fixture profile: ${String(value)}`);
}

function parseTopicCount(value: unknown): PerformanceTopicCount {
	if (value === 1_000) return 1_000;
	if (value === 10_000) return 10_000;
	throw new Error("topicCount must be 1000 or 10000.");
}

function parseSeed(value: unknown): number {
	if (
		typeof value !== "number" ||
		!Number.isSafeInteger(value) ||
		value < 0 ||
		value > 0xffff_ffff
	) throw new Error("seed must be an integer between 0 and 4294967295.");
	return value;
}

async function writeNewJsonFile(path: string, value: unknown): Promise<void> {
	await assertFileDoesNotExist(path);
	await makeParentDirectory(path);
	await Deno.writeTextFile(path, `${JSON.stringify(value, null, 2)}\n`, { createNew: true });
}

async function assertFileDoesNotExist(path: string): Promise<void> {
	try {
		await Deno.lstat(path);
		throw new Error(`Refusing to replace existing performance output: ${path}`);
	} catch (cause) {
		if (!(cause instanceof Deno.errors.NotFound)) throw cause;
	}
}

async function makeParentDirectory(path: string): Promise<void> {
	const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
	if (separator > 0) await Deno.mkdir(path.slice(0, separator), { recursive: true });
}

function fixtureId(seed: number, kind: number, index: number): string {
	return `${seed.toString(16).padStart(8, "0")}-${kind.toString(16).padStart(4, "0")}-4000-8000-${
		index.toString(16).padStart(12, "0")
	}`;
}

function fixtureTimestamp(index: number): string {
	return new Date(FIXTURE_BASE_TIME + index * FIXTURE_TIME_STEP_MS).toISOString();
}

function makeLink(seed: number, index: number, fromId: string, toId: string): OutlineLink {
	return {
		id: fixtureId(seed, 4, index),
		fromId,
		toId,
		from: { scope: "work", workId: fromId },
		to: { scope: "work", workId: toId },
		type: LINK_TYPE,
		status: "asserted",
		origin: "import",
		createdAt: fixtureTimestamp(index),
	};
}

function shuffle(values: number[], random: () => number): void {
	for (let index = values.length - 1; index > 0; index -= 1) {
		const other = Math.floor(random() * (index + 1));
		[values[index], values[other]] = [values[other], values[index]];
	}
}

function createRandom(seed: number, salt: number): () => number {
	let state = (seed ^ salt) >>> 0;
	return () => {
		state = (state + RNG_STEP) >>> 0;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
	};
}

function roundMs(value: number): number {
	return Math.round(value * 100) / 100;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function printHelp(): void {
	console.log(`Usage: deno task performance:fixture --options

Options:
  --profile <name>          baseline|deep-tree|dense-links|wide-tree|combined (default: baseline)
  --topic-count <count>     1000|10000 (default: 1000)
  --seed <number>           Unsigned 32-bit seed (default: 42)
  --output <path>           Write the fixture envelope as JSON
  --database <path>         Seed a new isolated SQLite database (must not exist)
  --manifest <path>         Write the deterministic manifest as JSON
  --validate <path>         Validate a fixture envelope and print its measured manifest
  --help                    Show this help
`);
}

if (import.meta.main) {
	try {
		await runCli(Deno.args);
	} catch (cause) {
		console.error(
			`Performance fixture failed: ${cause instanceof Error ? cause.message : String(cause)}`,
		);
		Deno.exit(1);
	}
}
