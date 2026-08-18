const isWindows = Deno.build.os === "windows";
const pathSeparator = isWindows ? "\\" : "/";
const surrealCliName = isWindows ? "surreal.exe" : "surreal";

function nativePath(url: URL): string {
	const path = decodeURIComponent(url.pathname);
	return isWindows ? path.slice(1).replaceAll("/", "\\") : path;
}

export async function copySurrealCli(outputDir: URL): Promise<void> {
	await Deno.mkdir(outputDir, { recursive: true });
	const source = await findSurrealCliSource();
	if (!source) {
		const message = "SurrealDB CLIのコピー元が見つかりません。" +
			"RADIORA_SURREAL_BUNDLE_SOURCE、PATH、またはUSERPROFILE\\.surrealdbを確認してください。";
		if (isWindows) throw new Error(message);
		console.warn(message);
		return;
	}
	try {
		const info = await Deno.stat(source);
		if (!info.isFile) throw new Error("not a file");
		const destination = new URL(surrealCliName, outputDir);
		await Deno.copyFile(source, destination);
		if (!isWindows) await Deno.chmod(destination, 0o755);
		console.log(`Bundled SurrealDB CLI: ${source} (${info.size} bytes)`);
	} catch (cause) {
		if (isWindows) {
			throw new Error(`SurrealDB CLIをbundleへコピーできません: ${source}`, { cause });
		}
		console.warn(`SurrealDB CLIをbundleへコピーできません: ${source}`);
	}
}

async function findSurrealCliSource(): Promise<string | null> {
	const explicitSource = Deno.env.get("RADIORA_SURREAL_BUNDLE_SOURCE");
	if (explicitSource) return explicitSource;
	const homeDir = isWindows ? Deno.env.get("USERPROFILE") : Deno.env.get("HOME");
	const candidates = homeDir
		? [`${homeDir}${pathSeparator}.surrealdb${pathSeparator}${surrealCliName}`]
		: [];
	if (isWindows && homeDir) {
		candidates.push(`${homeDir}\\scoop\\apps\\surrealdb\\current\\surreal.exe`);
		candidates.push(
			...(await commandPaths("scoop", ["which", "surreal"])).map((path) =>
				expandHomePath(path, homeDir)
			),
		);
	}
	const locator = isWindows ? "where.exe" : "which";
	candidates.push(
		...(await commandPaths(locator, [surrealCliName])).filter((path) => !isScoopShim(path)),
	);
	for (const candidate of candidates) {
		try {
			const info = await Deno.stat(candidate);
			if (info.isFile) return candidate;
			// biome-ignore lint/plugin/noSwallowedRejection: A missing candidate is expected during installation-path discovery.
		} catch {
			// Try the next known installation location.
		}
	}
	return null;
}

async function commandPaths(command: string, args: readonly string[]): Promise<string[]> {
	try {
		const output = await new Deno.Command(command, {
			args: [...args],
			stdout: "piped",
			stderr: "piped",
		}).output();
		if (!output.success) return [];
		return new TextDecoder().decode(output.stdout)
			.split(/\r?\n/)
			.map((path) => path.trim())
			.filter(Boolean);
	} catch {
		// Optional PATH discovery must not hide the explicit source error.
		return [];
	}
}

function expandHomePath(path: string, homeDir: string): string {
	return path === "~" ? homeDir : path.startsWith("~\\") ? `${homeDir}${path.slice(1)}` : path;
}

function isScoopShim(path: string): boolean {
	return isWindows && path.toLowerCase().includes("\\scoop\\shims\\");
}

export async function buildSurrealSidecar(outputDir: URL): Promise<void> {
	if (!isWindows) return;
	await Deno.mkdir(outputDir, { recursive: true });
	const command = new Deno.Command("go", {
		args: [
			"build",
			"-ldflags",
			"-H windowsgui",
			"-o",
			nativePath(new URL("radiora-surreal.exe", outputDir)),
			".",
		],
		cwd: new URL("../tools/surreal-sidecar/", import.meta.url),
		env: {
			...Deno.env.toObject(),
			CGO_ENABLED: "0",
			GOOS: "windows",
			GOARCH: "amd64",
		},
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	});
	const status = await command.spawn().status;
	if (!status.success) throw new Error("Go sidecarのビルドに失敗しました。");
	console.log("Built Go SurrealDB sidecar: radiora-surreal.exe");
}

if (import.meta.main) {
	const outputDir = new URL("../dist-desktop/radiora-v2-windows/", import.meta.url);
	await copySurrealCli(outputDir);
	await buildSurrealSidecar(outputDir);
}
