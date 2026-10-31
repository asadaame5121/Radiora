import {
	type GraphStateSnapshot,
	validatedGraphStateSnapshot,
} from "../../src/storage/graph_store.ts";
import type { Branch, OutlineLink, Revision } from "../../src/domain/models.ts";
import { detectOutlineKnots } from "../../src/services/occurrence_knot_detection.ts";
import {
	ACCEPTANCE_SHAPES,
	type AcceptanceShape,
	applyAcceptanceShape,
} from "./acceptance_shapes.ts";
import { fixtureId, fixtureTimestamp, makeLink } from "./entities.ts";
import { createPerformanceFixture as createBaselineFixture } from "./generator.ts";

const DEFAULT_ACCEPTANCE_NODE_COUNT = 1_000;
const STRESS_ACCEPTANCE_NODE_COUNT = 10_000;
const LONG_BODY_BYTE_COUNT = 2048;
const REVISIONS_PER_WORK = 4;
const DEFAULT_REVISION_COUNT = 0;
const DEFAULT_LINK_MULTIPLIER = 1;
const DENSE_LINK_MULTIPLIER = 8;
const UINT32_MAX = 0xffff_ffff;
const REVISION_FIXTURE_ID_KIND = 5;

export interface AcceptanceFixtureOptions {
	seed: number;
	nodeCount: 1_000 | 10_000;
	shape: AcceptanceShape;
	bodyBytes?: "short" | 2048;
	revisionsPerWork?: 0 | 4;
	linkMultiplier?: 1 | 8;
	timeShape?: "normal" | "same-time";
	hub?: boolean;
}

export interface AcceptanceFixtureManifest {
	fixtureVersion: 2;
	seed: number;
	nodeCount: number;
	shape: AcceptanceShape;
	bodyBytes: "short" | 2048;
	revisionsPerWork: 0 | 4;
	linkMultiplier: 1 | 8;
	timeShape: "normal" | "same-time";
	hub: boolean;
	rootCount: number;
	maximumDepth: number | null;
	cycleSize: number | null;
	edgeCount: number;
	revisionCount: number;
	totalTextBytes: number;
}

export interface AcceptanceFixture {
	manifest: AcceptanceFixtureManifest;
	state: GraphStateSnapshot;
}

export function createAcceptanceFixture(input: AcceptanceFixtureOptions): AcceptanceFixture {
	const options = validateOptions(input);
	const baseline = createBaselineFixture({
		profile: "baseline",
		topicCount: options.nodeCount,
		seed: options.seed,
	});

	const { state: shapedState, metadata } = applyAcceptanceShape(baseline.state, options.shape);
	const sameTime = fixtureTime(options.timeShape);
	const timed = applyTextOptions(shapedState, options, sameTime);
	const { branches, revisions } = createBranchesAndRevisions(shapedState, timed, options, sameTime);
	const links = createAcceptanceLinks(options, timed.works, sameTime);
	const knots = createFixtureKnots(shapedState, metadata.cycleSize);
	const state = validatedGraphStateSnapshot({
		...shapedState,
		works: timed.works,
		branches,
		workingCopies: timed.workingCopies,
		revisions,
		links,
		knots,
	});

	return {
		manifest: createManifest(
			options,
			metadata,
			links.length,
			revisions.length,
			timed.totalTextBytes,
		),
		state: validatedGraphStateSnapshot({
			...state,
			knots: createFixtureKnots(state, metadata.cycleSize),
		}),
	};
}

function fixtureTime(timeShape: NormalizedOptions["timeShape"]): string | null {
	return timeShape === "same-time" ? fixtureTimestamp(0) : null;
}

function applyTextOptions(
	state: GraphStateSnapshot,
	options: NormalizedOptions,
	sameTime: string | null,
): {
	works: GraphStateSnapshot["works"];
	workingCopies: GraphStateSnapshot["workingCopies"];
	totalTextBytes: number;
} {
	const works = state.works.map((work) => ({
		...work,
		createdAt: sameTime ?? work.createdAt,
		updatedAt: sameTime ?? work.updatedAt,
	}));
	const encoder = new TextEncoder();
	const replacementText = "x".repeat(LONG_BODY_BYTE_COUNT);
	let totalTextBytes = 0;
	const workingCopies = state.workingCopies.map((copy) => {
		const text = options.bodyBytes === LONG_BODY_BYTE_COUNT ? replacementText : copy.text;
		totalTextBytes += encoder.encode(text).length;
		return { ...copy, text, updatedAt: sameTime ?? copy.updatedAt };
	});
	return { works, workingCopies, totalTextBytes };
}

function createBranchesAndRevisions(
	state: GraphStateSnapshot,
	timed: ReturnType<typeof applyTextOptions>,
	options: NormalizedOptions,
	sameTime: string | null,
): { branches: Branch[]; revisions: Revision[] } {
	const branches: Branch[] = [];
	const revisions: Revision[] = [];
	for (let workIndex = 0; workIndex < timed.works.length; workIndex++) {
		const work = timed.works[workIndex];
		const baseBranch = state.branches[workIndex];
		const copy = timed.workingCopies[workIndex];
		let headRevisionId: string | null = null;
		if (options.revisionsPerWork === REVISIONS_PER_WORK) {
			for (let revisionIndex = 0; revisionIndex < REVISIONS_PER_WORK; revisionIndex++) {
				const index = workIndex * REVISIONS_PER_WORK + revisionIndex;
				const id = fixtureId(options.seed, REVISION_FIXTURE_ID_KIND, index);
				revisions.push({
					id,
					workId: work.id,
					text: copy.text,
					parentRevisionIds:
						revisionIndex === 0
							? []
							: [fixtureId(options.seed, REVISION_FIXTURE_ID_KIND, index - 1)],
					kind: "checkpoint",
					createdAt: sameTime ?? fixtureTimestamp(index),
				});
				headRevisionId = id;
			}
		}
		branches.push({
			...baseBranch,
			createdAt: sameTime ?? baseBranch.createdAt,
			headRevisionId,
		});
	}
	return { branches, revisions };
}

function createAcceptanceLinks(
	options: NormalizedOptions,
	works: GraphStateSnapshot["works"],
	sameTime: string | null,
): OutlineLink[] {
	const targetCount = options.nodeCount * options.linkMultiplier;
	const pairKeys = new Set<string>();
	const links: OutlineLink[] = [];
	const addLink = (from: number, to: number): void => {
		if (from === to) return;
		const key = `${from}->${to}`;
		if (pairKeys.has(key)) return;
		pairKeys.add(key);
		const link = makeLink(options.seed, links.length, works[from].id, works[to].id);
		if (sameTime) link.createdAt = sameTime;
		links.push(link);
	};
	if (options.hub) {
		for (let to = 1; to < options.nodeCount && links.length < targetCount; to++) addLink(0, to);
	}
	for (let distance = 1; distance < options.nodeCount && links.length < targetCount; distance++) {
		for (let index = 0; index < options.nodeCount && links.length < targetCount; index++) {
			addLink(index, (index + distance) % options.nodeCount);
		}
	}
	return links;
}

function createFixtureKnots(state: GraphStateSnapshot, cycleSize: number | null) {
	if (cycleSize === null) return state.knots;
	return detectOutlineKnots(
		state.occurrences.map(({ id, parentOccurrenceId }) => ({ id, parentId: parentOccurrenceId })),
	).map((knot) => ({ ...knot, createdAt: fixtureTimestamp(0) }));
}

function createManifest(
	options: NormalizedOptions,
	metadata: ReturnType<typeof applyAcceptanceShape>["metadata"],
	edgeCount: number,
	revisionCount: number,
	totalTextBytes: number,
): AcceptanceFixtureManifest {
	return {
		fixtureVersion: 2,
		seed: options.seed,
		nodeCount: options.nodeCount,
		shape: options.shape,
		bodyBytes: options.bodyBytes,
		revisionsPerWork: options.revisionsPerWork,
		linkMultiplier: options.linkMultiplier,
		timeShape: options.timeShape,
		hub: options.hub,
		rootCount: metadata.rootCount,
		maximumDepth: metadata.maximumDepth,
		cycleSize: metadata.cycleSize,
		edgeCount,
		revisionCount,
		totalTextBytes,
	};
}

interface NormalizedOptions {
	seed: number;
	nodeCount: 1_000 | 10_000;
	shape: AcceptanceShape;
	bodyBytes: "short" | 2048;
	revisionsPerWork: 0 | 4;
	linkMultiplier: 1 | 8;
	timeShape: "normal" | "same-time";
	hub: boolean;
}

function validateOptions(input: AcceptanceFixtureOptions): NormalizedOptions {
	if (
		typeof input.seed !== "number" ||
		!Number.isSafeInteger(input.seed) ||
		input.seed < 0 ||
		input.seed > UINT32_MAX
	) {
		throw new Error(`Invalid seed: ${input.seed}`);
	}
	if (
		input.nodeCount !== DEFAULT_ACCEPTANCE_NODE_COUNT &&
		input.nodeCount !== STRESS_ACCEPTANCE_NODE_COUNT
	) {
		throw new Error(`Invalid nodeCount: ${input.nodeCount}`);
	}
	if (!ACCEPTANCE_SHAPES.includes(input.shape)) {
		throw new Error(`Invalid shape: ${input.shape}`);
	}
	return {
		seed: input.seed,
		nodeCount: input.nodeCount,
		shape: input.shape,
		...validateAxisOptions(input),
	};
}

function validateAxisOptions(
	input: AcceptanceFixtureOptions,
): Pick<
	NormalizedOptions,
	"bodyBytes" | "revisionsPerWork" | "linkMultiplier" | "timeShape" | "hub"
> {
	return {
		bodyBytes: validateBodyBytes(input.bodyBytes),
		revisionsPerWork: validateRevisionCount(input.revisionsPerWork),
		linkMultiplier: validateLinkMultiplier(input.linkMultiplier),
		timeShape: validateTimeShape(input.timeShape),
		hub: validateHub(input.hub),
	};
}

function validateBodyBytes(value: unknown): NormalizedOptions["bodyBytes"] {
	const normalized = value ?? "short";
	if (normalized === "short" || normalized === LONG_BODY_BYTE_COUNT) return normalized;
	throw new Error(`Invalid bodyBytes: ${normalized}`);
}

function validateRevisionCount(value: unknown): NormalizedOptions["revisionsPerWork"] {
	const normalized = value ?? DEFAULT_REVISION_COUNT;
	if (normalized === DEFAULT_REVISION_COUNT || normalized === REVISIONS_PER_WORK) return normalized;
	throw new Error(`Invalid revisionsPerWork: ${normalized}`);
}

function validateLinkMultiplier(value: unknown): NormalizedOptions["linkMultiplier"] {
	const normalized = value ?? DEFAULT_LINK_MULTIPLIER;
	if (normalized === DEFAULT_LINK_MULTIPLIER || normalized === DENSE_LINK_MULTIPLIER) {
		return normalized;
	}
	throw new Error(`Invalid linkMultiplier: ${normalized}`);
}

function validateTimeShape(value: unknown): NormalizedOptions["timeShape"] {
	const normalized = value ?? "normal";
	if (normalized === "normal" || normalized === "same-time") return normalized;
	throw new Error(`Invalid timeShape: ${normalized}`);
}

function validateHub(value: unknown): boolean {
	const normalized = value ?? false;
	if (typeof normalized === "boolean") return normalized;
	throw new Error(`Invalid hub: ${normalized}`);
}
