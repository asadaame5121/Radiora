const MIN_TCP_PORT = 1;
const MAX_TCP_PORT = 65_535;

export function developmentUiOrigin(value: string | undefined): string | null {
	if (!value) return null;
	const url = new URL(value);
	if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") {
		throw new Error("RADIORA_HMR_UI_ORIGIN must be a local HTTP origin.");
	}
	return url.origin;
}

export function backendOriginFromServeAddress(address: string): string {
	const prefix = "tcp:127.0.0.1:";
	if (!address.startsWith(prefix)) throw new Error("DENO_SERVE_ADDRESS must use loopback TCP.");
	const port = address.slice(prefix.length);
	if (!/^[1-9]\d{0,4}$/.test(port)) throw new Error("DENO_SERVE_ADDRESS has an invalid port.");
	return `http://127.0.0.1:${port}`;
}

export function assertTcpPort(port: number): void {
	if (!Number.isInteger(port) || port < MIN_TCP_PORT || port > MAX_TCP_PORT) {
		throw new Error(`Invalid RADIORA_SURREAL_PORT: ${port}`);
	}
}

export async function findAvailablePort(): Promise<number> {
	const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
	try {
		const address = listener.addr;
		if (address.transport !== "tcp") throw new Error("Expected a TCP listener.");
		return address.port;
	} finally {
		listener.close();
	}
}

export function missingAssetResponse(path: string): Response {
	const body =
		`<!doctype html><html lang="ja"><meta charset="utf-8"><title>Radiora 起動エラー</title>
	<style>body{font:16px system-ui;background:#111310;color:#deddd6;padding:48px;line-height:1.7}code{color:#ffb8af}</style>
	<h1>Radioraを表示できません</h1><p>UIファイル <code>${path}</code> がbundleに含まれていません。</p>
	<p><code>deno task desktop</code> で再ビルドしてください。</p></html>`;
	return new Response(body, {
		status: 500,
		headers: { "content-type": "text/html; charset=utf-8" },
	});
}
