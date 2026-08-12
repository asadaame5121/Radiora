export const LATEST_RELEASE_URL =
	"https://api.github.com/repos/asadaame5121/Radiora/releases/latest";
export const RELEASE_PAGE_URL = "https://github.com/asadaame5121/Radiora/releases";

export interface ReleaseInfo {
	tagName: string;
	version: string;
	url: string;
	publishedAt: string | null;
}

export interface UpdateCheckResult {
	currentVersion: string;
	latest: ReleaseInfo | null;
	updateAvailable: boolean;
	error: string | null;
}

export type UpdateFetcher = (
	url: string,
	init?: RequestInit,
) => Promise<Pick<Response, "ok" | "json">>;

export async function checkForUpdate(
	currentVersion: string,
	fetcher: UpdateFetcher = fetch,
): Promise<UpdateCheckResult> {
	try {
		const response = await fetcher(LATEST_RELEASE_URL, {
			headers: { accept: "application/vnd.github+json" },
		});
		if (!response.ok) throw new Error(`GitHub release request failed: ${response.ok}`);
		const payload = await response.json() as {
			tag_name?: unknown;
			html_url?: unknown;
			published_at?: unknown;
		};
		const tagName = typeof payload.tag_name === "string" ? payload.tag_name : "";
		const version = versionFromTag(tagName);
		const url = typeof payload.html_url === "string" ? payload.html_url : "";
		if (!version || !isSafeReleaseUrl(url)) throw new Error("GitHub release response was invalid.");
		return {
			currentVersion,
			latest: {
				tagName,
				version,
				url,
				publishedAt: typeof payload.published_at === "string" ? payload.published_at : null,
			},
			updateAvailable: compareVersions(version, currentVersion) > 0,
			error: null,
		};
	} catch (cause) {
		return {
			currentVersion,
			latest: null,
			updateAvailable: false,
			error: cause instanceof Error ? cause.message : String(cause),
		};
	}
}

export function versionFromTag(tagName: string): string | null {
	const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tagName.trim());
	return match ? `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}` : null;
}

export function compareVersions(left: string, right: string): number {
	const leftParts = parseVersion(left);
	const rightParts = parseVersion(right);
	if (!leftParts || !rightParts) return 0;
	for (let index = 0; index < leftParts.length; index++) {
		if (leftParts[index] !== rightParts[index]) {
			return leftParts[index] > rightParts[index] ? 1 : -1;
		}
	}
	return 0;
}

function parseVersion(value: string): [number, number, number] | null {
	const normalized = versionFromTag(value);
	if (!normalized) return null;
	return normalized.split(".").map(Number) as [number, number, number];
}

function isSafeReleaseUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "https:" && url.hostname === "github.com" &&
			url.pathname.startsWith("/asadaame5121/Radiora/releases/");
	} catch {
		return false;
	}
}
