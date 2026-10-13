import type { LinkType, OutlineLink } from "../../src/domain/models.ts";
import { LINK_TYPES } from "../../src/domain/models.ts";
import { FIXTURE_BASE_TIME, FIXTURE_TIME_STEP_MS } from "./model.ts";

export const FIXTURE_LINK_TYPE: LinkType = LINK_TYPES[0];
const SEED_HEX_LENGTH = 8;
const KIND_HEX_LENGTH = 4;
const INDEX_HEX_LENGTH = 12;
const HEX_RADIX = 16;
const FIXTURE_V4_UUID_SEGMENT = "4000";
const FIXTURE_UUID_VARIANT_SEGMENT = "8000";
const LINK_FIXTURE_ID_KIND = 4;

export function fixtureId(seed: number, kind: number, index: number): string {
	return [
		seed.toString(HEX_RADIX).padStart(SEED_HEX_LENGTH, "0"),
		kind.toString(HEX_RADIX).padStart(KIND_HEX_LENGTH, "0"),
		FIXTURE_V4_UUID_SEGMENT,
		FIXTURE_UUID_VARIANT_SEGMENT,
		index.toString(HEX_RADIX).padStart(INDEX_HEX_LENGTH, "0"),
	].join("-");
}

export function fixtureTimestamp(index: number): string {
	return new Date(FIXTURE_BASE_TIME + index * FIXTURE_TIME_STEP_MS).toISOString();
}

export function makeLink(
	seed: number,
	index: number,
	fromId: string,
	toId: string,
): OutlineLink {
	return {
		id: fixtureId(seed, LINK_FIXTURE_ID_KIND, index),
		fromId,
		toId,
		from: { scope: "work", workId: fromId },
		to: { scope: "work", workId: toId },
		type: FIXTURE_LINK_TYPE,
		status: "asserted",
		origin: "import",
		createdAt: fixtureTimestamp(index),
	};
}
