import { collectRuntimeDependencies } from "./license_dependencies.ts";

const repoRoot = new URL("../", import.meta.url);
const docsLicenses = new URL("docs/licenses/", repoRoot);
const outputs = [
	new URL("dist-desktop/licenses/", repoRoot),
	new URL("dist/licenses/", repoRoot),
];

async function existsUrl(url: URL): Promise<boolean> {
	try {
		await Deno.lstat(url);
		return true;
	} catch {
		return false;
	}
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
	const deps = await collectRuntimeDependencies();

	const npmEntries: LicenseEntry[] = [];
	const copied: { file: string; source: URL }[] = [];
	for (const dep of deps) {
		const packageDir = dep.directory;
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
