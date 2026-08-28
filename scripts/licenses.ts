const repoRoot = new URL("../", import.meta.url);
const nodeModules = new URL("node_modules/", repoRoot);
const docsLicenses = new URL("docs/licenses/", repoRoot);
const outputs = [
	new URL("dist-desktop/licenses/", repoRoot),
	new URL("dist/licenses/", repoRoot),
];

interface LockPackage {
	name?: string;
	version?: string;
	license?: string | { type: string } | Array<{ type: string }>;
	dependencies?: Record<string, string>;
}

function licenseLabel(license: LockPackage["license"]): string {
	if (typeof license === "string") return license;
	if (Array.isArray(license)) return license.map((item) => item.type).join(", ");
	if (license && typeof license === "object") return license.type;
	return "見つかりません";
}

async function existsUrl(url: URL): Promise<boolean> {
	try {
		await Deno.lstat(url);
		return true;
	} catch {
		return false;
	}
}

function resolvePackageKey(
	lock: Record<string, LockPackage>,
	parentKey: string | null,
	depName: string,
): string | null {
	const direct = parentKey ? `${parentKey}/node_modules/${depName}` : null;
	if (direct && lock[direct]) return direct;
	const cut = parentKey ? parentKey.lastIndexOf("/node_modules/") : -1;
	if (parentKey && cut >= 0) {
		const siblingRoot = parentKey.slice(0, cut);
		const sibling = `${siblingRoot}/node_modules/${depName}`;
		if (lock[sibling]) return sibling;
	}
	const root = `node_modules/${depName}`;
	return lock[root] ? root : null;
}

function collectRuntimeDependencies(
	lock: Record<string, LockPackage>,
): { key: string; name: string; version: string; licenseLabel: string }[] {
	const roots = lock[""]?.dependencies ?? {};
	const visited = new Set<string>();
	const entries: { key: string; name: string; version: string; licenseLabel: string }[] = [];
	const queue: { name: string; parentKey: string | null }[] = Object.keys(roots).map((name) => ({
		name,
		parentKey: null,
	}));
	while (queue.length > 0) {
		const { name, parentKey } = queue.shift()!;
		const key = resolvePackageKey(lock, parentKey, name);
		if (!key || visited.has(key)) continue;
		visited.add(key);
		const pkg = lock[key];
		entries.push({
			key,
			name: pkg.name ?? name,
			version: pkg.version ?? "",
			licenseLabel: licenseLabel(pkg.license),
		});
		for (const dep of Object.keys(pkg.dependencies ?? {})) {
			queue.push({ name: dep, parentKey: key });
		}
	}
	entries.sort((a, b) => a.key.localeCompare(b.key));
	return entries;
}

async function findLicenseFile(packageDir: URL): Promise<URL | null> {
	const candidates = ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENSE-MIT", "License", "LICENCE"];
	for (const candidate of candidates) {
		const url = new URL(candidate, packageDir);
		if (await existsUrl(url)) return url;
	}
	const dir = new URL("LICENSES/", packageDir);
	if (await existsUrl(dir)) {
		for await (const entry of Deno.readDir(dir)) {
			if (entry.isFile && entry.name.toUpperCase().startsWith("LICENSE")) {
				return new URL(entry.name, dir);
			}
		}
	}
	return null;
}

function urlFileName(url: URL): string {
	const parts = url.pathname.split("/");
	return parts[parts.length - 1];
}

interface LicenseEntry {
	name: string;
	version: string;
	license: string;
	file: string | null;
	summary: string;
}

const runtimeEntries: LicenseEntry[] = [
	{
		name: "Deno / Deno Desktop runtime",
		version: "2.9+",
		license: "MIT",
		file: "runtime/deno-MIT.txt",
		summary: "DenoランタイムとDeno Desktopがアプリの実行基盤として含まれます。",
	},
	{
		name: "Chromium Embedded Framework (CEF)",
		version: "bundled",
		license: "BSD-3-Clause (CEF) / BSD-3-Clause (Chromium)",
		file: "runtime/cef-LICENSE.txt",
		summary:
			"UI描画用のChromium系レンダラーが含まれます。Chromiumのライセンスは別ファイルに収録しています。",
	},
];

async function main(): Promise<void> {
	const lockText = await Deno.readTextFile(new URL("package-lock.json", repoRoot));
	const lock = JSON.parse(lockText) as { packages: Record<string, LockPackage> };
	const deps = collectRuntimeDependencies(lock.packages);

	const npmEntries: LicenseEntry[] = [];
	const copied: { file: string; source: URL }[] = [];
	for (const dep of deps) {
		const packageDir = new URL(`${dep.key.replace(/^node_modules\//, "")}/`, nodeModules);
		const licenseFile = await findLicenseFile(packageDir);
		let file = null;
		if (licenseFile) {
			const safeName = `${dep.name.replace(/[/@]/g, "-")}@${dep.version}`;
			file = `npm/${safeName}/${urlFileName(licenseFile)}`;
			copied.push({
				file,
				source: licenseFile,
			});
		}
		npmEntries.push({
			name: dep.name,
			version: dep.version,
			license: dep.licenseLabel,
			file,
			summary: "",
		});
	}

	for (const output of outputs) {
		// biome-ignore lint/plugin/noSwallowedRejection: A missing generated license directory is the expected clean-build state.
		await Deno.remove(output, { recursive: true }).catch(() => undefined);
		await Deno.mkdir(new URL("npm/", output), { recursive: true });
		await Deno.mkdir(new URL("runtime/", output), { recursive: true });

		for (const entry of copied) {
			const target = new URL(entry.file!, output);
			await Deno.mkdir(new URL("./", target), { recursive: true });
			await Deno.copyFile(entry.source, target);
		}
		for await (const entry of Deno.readDir(docsLicenses)) {
			if (entry.isFile) {
				await Deno.copyFile(
					new URL(entry.name, docsLicenses),
					new URL(`runtime/${entry.name}`, output),
				);
			}
		}

		const index = {
			runtime: runtimeEntries,
			npm: npmEntries,
		};
		await Deno.writeTextFile(new URL("index.json", output), JSON.stringify(index, null, "\t"));

		const lines = [
			"Radiora - サードパーティライセンス通知",
			"========================================",
			"",
			"Radioraは以下のサードパーティソフトウェアを含みます。ライセンス全文は、このディレクトリの",
			"npm/ および runtime/ フォルダに、一覧のファイル名で収録しています。",
			"",
			"--- ランタイムコンポーネント ---",
			...runtimeEntries.map(
				(entry) =>
					`- ${entry.name} ${entry.version} (${entry.license})\n  ${entry.summary}\n  全文: ${entry.file}`,
			),
			"",
			"--- npmパッケージ ---",
			...npmEntries.map(
				(entry) =>
					`- ${entry.name} ${entry.version} (${entry.license})${
						entry.file ? `\n  全文: ${entry.file}` : ""
					}`,
			),
			"",
			"--- ライセンス全文は各フォルダを参照 ---",
			"",
		];
		await Deno.writeTextFile(new URL("THIRD_PARTY_NOTICES.txt", output), lines.join("\n"));
		console.log(`ライセンス情報を出力しました: ${output.pathname}`);
	}
}

await main();
