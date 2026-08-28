if (Deno.build.os !== "windows") {
	throw new Error("MSIXパッケージの作成はWindows PowerShellまたはNushellから実行してください。");
}

function argValue(name: string): string | null {
	const index = Deno.args.indexOf(name);
	return index >= 0 && index + 1 < Deno.args.length ? Deno.args[index + 1] : null;
}

const publisher = argValue("--publisher") ?? "CN=Radiora Dev";
const certArg = argValue("--cert");
const certPasswordArg = argValue("--cert-password");
const versionArg = argValue("--version");
const outputArg = argValue("--output");

const repoRoot = new URL("../", import.meta.url);
const denoConfig = JSON.parse(
	await Deno.readTextFile(new URL("deno.json", repoRoot)),
) as { version?: string };
const defaultVersion = `${denoConfig.version ?? "0.1.0"}.0`;
const version = versionArg ?? defaultVersion;
const bundleDir = new URL("dist-desktop/radiora-v2-windows/", repoRoot);
const stagingDir = new URL("dist-desktop/msix-staging/", repoRoot);
const licensesDir = new URL("dist-desktop/licenses/", repoRoot);
const msixPath = outputArg
	? new URL(outputArg, repoRoot)
	: new URL(`dist-desktop/Radiora_${version}_x64.msix`, repoRoot);
const devCertPfx = new URL("dist-desktop/radiora-dev-signing.pfx", repoRoot);
const devCertCer = new URL("dist-desktop/radiora-dev-signing.cer", repoRoot);

function winPath(url: URL): string {
	return url.pathname.slice(1).replaceAll("/", "\\");
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await Deno.lstat(path);
		return true;
	} catch {
		return false;
	}
}

async function urlExists(url: URL): Promise<boolean> {
	try {
		await Deno.lstat(url);
		return true;
	} catch {
		return false;
	}
}

async function requireUrlExists(url: URL, message: string): Promise<void> {
	if (!(await urlExists(url))) throw new Error(message);
}

async function findWindowsKitTool(name: string): Promise<string> {
	const envBin = Deno.env.get("WINDOWS_KIT_BIN");
	if (envBin) {
		const candidate = `${envBin}\\${name}.exe`;
		if (await pathExists(candidate)) return candidate;
	}
	const roots = [
		"C:\\Program Files (x86)\\Windows Kits\\10\\bin",
		"C:\\Program Files\\Windows Kits\\10\\bin",
	];
	for (const root of roots) {
		if (!(await pathExists(root))) continue;
		const versions = [];
		for await (const entry of Deno.readDir(root)) {
			if (entry.isDirectory && /^\d/.test(entry.name)) versions.push(entry.name);
		}
		versions.sort();
		for (const versionDir of versions.toReversed()) {
			const candidate = `${root}\\${versionDir}\\x64\\${name}.exe`;
			if (await pathExists(candidate)) return candidate;
		}
	}
	const which = new Deno.Command("where", { args: [name], stdout: "piped", stderr: "piped" });
	const result = await which.output();
	if (result.success) {
		const found = new TextDecoder().decode(result.stdout).split(/\r?\n/)[0];
		if (found) return found;
	}
	throw new Error(
		`${name}.exe が見つかりません。Windows SDKをインストールするか、WINDOWS_KIT_BIN でbinディレクトリを指定してください。`,
	);
}

async function runPowerShell(
	script: string,
	env: Record<string, string>,
	description: string,
): Promise<void> {
	for (const [key, value] of Object.entries(env)) Deno.env.set(`RADIORA_PS_${key}`, value);
	const command = new Deno.Command("powershell.exe", {
		args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
		stdout: "inherit",
		stderr: "inherit",
	});
	const status = await command.spawn().status;
	if (!status.success) throw new Error(`${description}に失敗しました。`);
}

async function copyDirRecursive(source: URL, dest: URL): Promise<void> {
	await Deno.mkdir(dest, { recursive: true });
	for await (const entry of Deno.readDir(source)) {
		const srcPath = new URL(entry.name, source);
		const destPath = new URL(entry.name, dest);
		if (entry.isDirectory) {
			await copyDirRecursive(srcPath, destPath);
		} else {
			await Deno.copyFile(srcPath, destPath);
		}
	}
}

function packageVersionParts(version: string): string[] {
	const parts = version.split(".").map((part) => part.replace(/\D/g, ""));
	while (parts.length < 4) parts.push("0");
	return parts.slice(0, 4);
}

async function ensureSigningCertificate(): Promise<{ cert: string; password: string | null }> {
	if (certArg) {
		return { cert: winPath(new URL(certArg, repoRoot)), password: certPasswordArg };
	}
	if (await urlExists(devCertPfx)) {
		console.log(`既存の開発用署名証明書を再利用します: ${winPath(devCertPfx)}`);
		return { cert: winPath(devCertPfx), password: "radiora-dev-signing" };
	}
	const cn = publisher.replace(/^CN=\s*/, "");
	const password = "radiora-dev-signing";
	await runPowerShell(
		[
			"$cn = $env:RADIORA_PS_CN",
			"$pfx = $env:RADIORA_PS_PFX",
			"$cer = $env:RADIORA_PS_CER",
			"$password = $env:RADIORA_PS_PASSWORD",
			'$cert = New-SelfSignedCertificate -Type Custom -Subject "CN=$cn" -KeyUsage DigitalSignature -KeyAlgorithm RSA -KeyLength 2048 -CertStoreLocation Cert:\\CurrentUser\\My -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3")',
			"$pwd = ConvertTo-SecureString -String $password -AsPlainText -Force",
			"Export-PfxCertificate -Cert $cert -FilePath $pfx -Password $pwd | Out-Null",
			"Export-Certificate -Cert $cert -FilePath $cer | Out-Null",
			"Write-Output $cert.Subject",
		].join("; "),
		{
			CN: cn,
			PFX: winPath(devCertPfx),
			CER: winPath(devCertCer),
			PASSWORD: password,
		},
		"開発用署名証明書の生成",
	);
	console.log(`開発用署名証明書を生成しました: ${winPath(devCertPfx)}`);
	return { cert: winPath(devCertPfx), password };
}

export async function assertCleanBundle(dir: URL): Promise<void> {
	await requireUrlExists(
		dir,
		"先に deno task desktop:build を実行してbundleを生成してください。",
	);
	if (await urlExists(new URL("surreal.exe", dir))) {
		throw new Error(
			"古い surreal.exe がbundle内に残っています。先に 'deno task desktop:build' でclean rebuildしてください。",
		);
	}
	if (await urlExists(new URL("radiora-surreal.exe", dir))) {
		throw new Error(
			"古い radiora-surreal.exe がbundle内に残っています。先に 'deno task desktop:build' でclean rebuildしてください。",
		);
	}
}

export async function findLauncher(dir: URL): Promise<string> {
	for await (const entry of Deno.readDir(dir)) {
		if (
			entry.isFile &&
			entry.name.endsWith(".exe") &&
			!entry.name.startsWith("bootstrap") &&
			entry.name.toLowerCase() !== "surreal.exe" &&
			entry.name.toLowerCase() !== "radiora-surreal.exe"
		) {
			return entry.name;
		}
	}
	throw new Error("bundle内にlauncher (.exe) が見つかりません。");
}

async function main(): Promise<void> {
	await assertCleanBundle(bundleDir);
	const launcherName = await findLauncher(bundleDir);
	const [major, minor, build, revision] = packageVersionParts(version);

	// biome-ignore lint/plugin/noSwallowedRejection: A missing staging directory is the expected first-build state.
	await Deno.remove(stagingDir, { recursive: true }).catch(() => undefined);
	await Deno.mkdir(stagingDir, { recursive: true });
	await copyDirRecursive(bundleDir, stagingDir);
	if (await urlExists(licensesDir)) {
		await copyDirRecursive(licensesDir, new URL("Licenses/", stagingDir));
	}

	const assetsDir = new URL("Assets/", stagingDir);
	await Deno.mkdir(assetsDir, { recursive: true });
	await runPowerShell(
		[
			"Add-Type -AssemblyName System.Drawing",
			"$srcPath = $env:RADIORA_PS_SRC",
			"$outDir = $env:RADIORA_PS_OUT",
			"$src = [System.Drawing.Image]::FromFile($srcPath)",
			"function New-Square([System.Drawing.Image]$src, [int]$size, [string]$out) {",
			"  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)",
			"  $g = [System.Drawing.Graphics]::FromImage($bmp)",
			"  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic",
			"  $g.Clear([System.Drawing.Color]::Transparent)",
			"  $g.DrawImage($src, 0, 0, $size, $size)",
			"  $g.Dispose()",
			"  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)",
			"  $bmp.Dispose()",
			"}",
			'New-Square $src 150 "$outDir\\Square150x150Logo.png"',
			'New-Square $src 71 "$outDir\\Square71x71Logo.png"',
			'New-Square $src 44 "$outDir\\Square44x44Logo.png"',
			'New-Square $src 50 "$outDir\\StoreLogo.png"',
			"$bmp = New-Object System.Drawing.Bitmap(310, 150, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)",
			"$g = [System.Drawing.Graphics]::FromImage($bmp)",
			"$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic",
			"$g.Clear([System.Drawing.Color]::Transparent)",
			"$g.DrawImage($src, 80, 0, 150, 150)",
			"$g.Dispose()",
			'$bmp.Save("$outDir\\Wide310x150Logo.png", [System.Drawing.Imaging.ImageFormat]::Png)',
			"$bmp.Dispose()",
			"$src.Dispose()",
		].join("; "),
		{
			SRC: winPath(new URL("src/Radiora_icon.png", repoRoot)),
			OUT: winPath(assetsDir),
		},
		"MSIX用アイコンの生成",
	);

	const manifest = `<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
	xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
	xmlns:desktop="http://schemas.microsoft.com/appx/manifest/desktop/windows10"
	xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
	IgnorableNamespaces="uap desktop rescap">
	<Identity Name="dev.radiora.v2" Publisher="${publisher}" Version="${major}.${minor}.${build}.${revision}" ProcessorArchitecture="x64"/>
	<Properties>
		<DisplayName>Radiora</DisplayName>
		<PublisherDisplayName>Radiora</PublisherDisplayName>
		<Description>Radioraは、日々生じる短い着想から長文の稿までを同じ「思索」として保存するローカルアウトライナーです。</Description>
		<Logo>Assets\StoreLogo.png</Logo>
	</Properties>
	<Resources>
		<Resource Language="ja-jp"/>
	</Resources>
	<Dependencies>
		<TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.26100.0"/>
	</Dependencies>
	<Capabilities>
		<rescap:Capability Name="runFullTrust"/>
	</Capabilities>
	<Applications>
		<Application Id="Radiora" Executable="${launcherName}" EntryPoint="windows.fullTrustProcess">
			<uap:VisualElements DisplayName="Radiora"
				Description="Radioraは、日々生じる短い着想から長文の稿までを同じ「思索」として保存するローカルアウトライナーです。"
				Square150x150Logo="Assets\Square150x150Logo.png"
				Square44x44Logo="Assets\Square44x44Logo.png"
				BackgroundColor="transparent"/>
		</Application>
	</Applications>
	<Extensions>
		<desktop:Extension Category="windows.fullTrustProcess" Executable="${launcherName}"/>
		<uap:Extension Category="windows.protocol">
			<uap:Protocol Name="radiora"/>
		</uap:Extension>
	</Extensions>
</Package>
`;
	await Deno.writeTextFile(new URL("AppxManifest.xml", stagingDir), manifest);

	const makeappx = await findWindowsKitTool("makeappx");
	const pack = new Deno.Command(makeappx, {
		args: ["pack", "/d", winPath(stagingDir), "/p", winPath(msixPath), "/o"],
		stdout: "inherit",
		stderr: "inherit",
	});
	if (!(await pack.spawn().status).success) {
		throw new Error("makeappx によるパッケージ生成に失敗しました。");
	}

	const { cert, password } = await ensureSigningCertificate();
	const signtool = await findWindowsKitTool("signtool");
	const sign = new Deno.Command(signtool, {
		args: [
			"sign",
			"/fd",
			"SHA256",
			"/f",
			cert,
			...(password ? ["/p", password] : []),
			winPath(msixPath),
		],
		stdout: "inherit",
		stderr: "inherit",
	});
	if (!(await sign.spawn().status).success) {
		throw new Error("MSIXへの署名に失敗しました。");
	}

	console.log("");
	console.log(`MSIXパッケージを生成しました: ${winPath(msixPath)}`);
	if (!certArg) {
		console.log("テスト機では開発用証明書を信頼してからインストールしてください:");
		console.log(`  certutil -addstore Root ${winPath(devCertCer)}`);
		console.log(`  Add-AppxPackage -Path ${winPath(msixPath)}`);
	}
}

if (import.meta.main) {
	await main();
}
