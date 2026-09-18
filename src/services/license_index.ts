import * as v from "valibot";

const LicenseEntrySchema = v.object({
	name: v.string(),
	version: v.string(),
	license: v.string(),
	file: v.nullable(v.string()),
	summary: v.string(),
});

const LicenseIndexSchema = v.object({
	runtime: v.array(LicenseEntrySchema),
	npm: v.array(LicenseEntrySchema),
});

export type LicenseEntry = v.InferOutput<typeof LicenseEntrySchema>;
export type LicenseIndex = v.InferOutput<typeof LicenseIndexSchema>;

export async function fetchLicenseIndex(
	fetcher: typeof fetch = fetch,
): Promise<LicenseIndex> {
	const response = await fetcher("/licenses/index.json");
	if (!response.ok) {
		throw new Error(`ライセンス情報を読み込めませんでした (${response.status})`);
	}
	if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
		throw new Error("ライセンス情報を読み込めませんでした (JSONではありません)");
	}
	try {
		return v.parse(LicenseIndexSchema, await response.json());
	} catch (cause) {
		throw new Error("ライセンス情報の形式が不正です", { cause });
	}
}
