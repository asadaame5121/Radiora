import type { GraphStateSnapshot } from "../../src/storage/graph_store.ts";

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

export const FIXTURE_VERSION = 1;
export const FIXTURE_BASE_TIME = Date.UTC(2025, 0, 1);
export const FIXTURE_TIME_STEP_MS = 1_000;
export const BASE_TREE_MAX_DEPTH = 8;
export const LINK_COUNT_PER_TOPIC = 2;
export const DENSE_HUB_DEGREE_DIVISOR = 40;
export const TEXT_RANDOM_SALT = 0x6d2b79f5;
export const RNG_STEP = 0x6d2b79f5;
export const TREE_RANDOM_SALT = 0x1b873593;
export const LINK_RANDOM_SALT = 0x85ebca6b;
export const SAMPLE_RANDOM_SALT = 0xc2b2ae35;

export function parseProfile(value: unknown): PerformanceFixtureProfile {
	if (value === "baseline") return "baseline";
	if (value === "deep-tree") return "deep-tree";
	if (value === "dense-links") return "dense-links";
	if (value === "wide-tree") return "wide-tree";
	if (value === "combined") return "combined";
	throw new Error(`Invalid performance fixture profile: ${String(value)}`);
}

export function parseTopicCount(value: unknown): PerformanceTopicCount {
	if (value === 1_000) return 1_000;
	if (value === 10_000) return 10_000;
	throw new Error("topicCount must be 1000 or 10000.");
}

export function parseSeed(value: unknown): number {
	if (
		typeof value !== "number" ||
		!Number.isSafeInteger(value) ||
		value < 0 ||
		value > 0xffff_ffff
	) throw new Error("seed must be an integer between 0 and 4294967295.");
	return value;
}
