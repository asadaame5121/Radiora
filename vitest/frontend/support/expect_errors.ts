import { expect } from "vitest";

type ErrorConstructor = abstract new (...args: never[]) => Error;

/**
 * 同期throwの型とメッセージ部分一致を1回の実行で検査する。
 *
 * Vitestの`toThrow`はクラスかメッセージのどちらか一方しか受け取らないため、
 * Deno時代の「型とメッセージを同時に検査する」契約を維持するための小さな補助。
 * Deno APIの互換層ではなく、アサーション自体はネイティブの`expect`で行う。
 */
export function expectThrown(
	run: () => unknown,
	errorClass?: ErrorConstructor,
	messageIncludes?: string,
	assertionMessage?: string,
): unknown {
	const result = captureThrown(run);
	expect(result.threw, assertionMessage ?? "Expected the function to throw").toBe(true);
	if (errorClass !== undefined) expect(result.error).toBeInstanceOf(errorClass);
	if (messageIncludes !== undefined) expect(String(result.error)).toContain(messageIncludes);
	return result.error;
}

/** 非同期rejectionの型とメッセージ部分一致を1回の実行で検査する。 */
export async function expectRejected(
	run: () => Promise<unknown>,
	errorClass?: ErrorConstructor,
	messageIncludes?: string,
	assertionMessage?: string,
): Promise<unknown> {
	const result = await captureRejected(run);
	expect(result.rejected, assertionMessage ?? "Expected the promise to reject").toBe(true);
	if (errorClass !== undefined) expect(result.error).toBeInstanceOf(errorClass);
	if (messageIncludes !== undefined) expect(String(result.error)).toContain(messageIncludes);
	return result.error;
}

function captureThrown(run: () => unknown): { threw: boolean; error: unknown } {
	try {
		run();
		return { threw: false, error: undefined };
	} catch (error) {
		return { threw: true, error };
	}
}

async function captureRejected(
	run: () => Promise<unknown>,
): Promise<{ rejected: boolean; error: unknown }> {
	try {
		await run();
		return { rejected: false, error: undefined };
	} catch (error) {
		return { rejected: true, error };
	}
}
