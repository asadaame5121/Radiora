import type { OutlineItem, OutlineLink, OutlineSnapshot } from "../domain/models.ts";

export const STARTUP_SNAPSHOT_CACHE_MAX_BYTES = 2_000_000;

export interface StartupSnapshotLocation {
	readonly selectedOccurrenceId: string | null;
	readonly hoistOccurrenceId: string | null;
}

export interface StartupSnapshotCache {
	readonly version: 1;
	readonly savedAt: string;
	readonly snapshot: OutlineSnapshot;
	readonly location: StartupSnapshotLocation;
}

export interface StartupSnapshotCacheOptions {
	now?: () => string;
	maxBytes?: number;
}

export function createStartupSnapshotCache(
	snapshot: OutlineSnapshot,
	location: StartupSnapshotLocation,
	options: StartupSnapshotCacheOptions = {},
): StartupSnapshotCache | null {
	if (!isOutlineSnapshot(snapshot) || !isLocation(location)) return null;
	const value: StartupSnapshotCache = {
		version: 1,
		savedAt: (options.now ?? (() => new Date().toISOString()))(),
		snapshot,
		location,
	};
	const serialized = JSON.stringify(value);
	const maxBytes = options.maxBytes ?? STARTUP_SNAPSHOT_CACHE_MAX_BYTES;
	return new TextEncoder().encode(serialized).byteLength <= maxBytes ? value : null;
}

export function parseStartupSnapshotCache(raw: string): StartupSnapshotCache | null {
	try {
		const value: unknown = JSON.parse(raw);
		return isStartupSnapshotCache(value) ? value : null;
	} catch {
		return null;
	}
}

function isStartupSnapshotCache(value: unknown): value is StartupSnapshotCache {
	if (!isRecord(value) || value.version !== 1 || !isIsoDate(value.savedAt)) return false;
	return isOutlineSnapshot(value.snapshot) && isLocation(value.location);
}

function isOutlineSnapshot(value: unknown): value is OutlineSnapshot {
	if (!isRecord(value)) return false;
	return Array.isArray(value.items) && value.items.every(isOutlineItem) &&
		Array.isArray(value.links) && value.links.every(isOutlineLink) &&
		Array.isArray(value.knots) && value.knots.every(isKnot) && isStringArray(value.stashItemIds);
}

function isOutlineItem(value: unknown): value is OutlineItem {
	if (!isRecord(value)) return false;
	return typeof value.id === "string" && typeof value.workId === "string" &&
		typeof value.text === "string" && isNullableString(value.parentId) &&
		typeof value.orderKey === "number" && Number.isFinite(value.orderKey) &&
		typeof value.collapsed === "boolean" && isRevisionSelector(value.revisionSelector) &&
		(value.contextualHeading === undefined || typeof value.contextualHeading === "string") &&
		(value.referenceStub === undefined || typeof value.referenceStub === "boolean") &&
		isIsoDate(value.createdAt) && isIsoDate(value.updatedAt);
}

function isOutlineLink(value: unknown): value is OutlineLink {
	if (!isRecord(value)) return false;
	return typeof value.id === "string" && typeof value.fromId === "string" &&
		typeof value.toId === "string" && isLinkEndpoint(value.from) && isLinkEndpoint(value.to) &&
		typeof value.type === "string" && typeof value.status === "string" &&
		typeof value.origin === "string" && isIsoDate(value.createdAt) &&
		(value.reason === undefined || typeof value.reason === "string");
}

function isRevisionSelector(value: unknown): boolean {
	if (!isRecord(value)) return false;
	return value.mode === "branch" && typeof value.branchId === "string" ||
		value.mode === "pinned" && typeof value.revisionId === "string";
}

function isLinkEndpoint(value: unknown): boolean {
	if (!isRecord(value) || typeof value.workId !== "string") return false;
	return value.scope === "work" ||
		value.scope === "revision" && typeof value.revisionId === "string";
}

function isKnot(value: unknown): boolean {
	return isRecord(value) && typeof value.id === "string" && isStringArray(value.cycleIds) &&
		isIsoDate(value.createdAt);
}

function isLocation(value: unknown): value is StartupSnapshotLocation {
	return isRecord(value) && isNullableString(value.selectedOccurrenceId) &&
		isNullableString(value.hoistOccurrenceId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isNullableString(value: unknown): value is string | null {
	return value === null || typeof value === "string";
}

function isIsoDate(value: unknown): value is string {
	return typeof value === "string" && Number.isFinite(Date.parse(value));
}
