import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { SurrealConnection, type SurrealConnectionDriver } from "./surreal_connection.ts";

class RecordingDriver implements SurrealConnectionDriver {
	readonly calls: string[] = [];
	failOnConnect = false;

	async connect(): Promise<void> {
		this.calls.push("connect");
		if (this.failOnConnect) throw new Error("offline");
	}

	async use(): Promise<void> {
		this.calls.push("use");
	}

	async close(): Promise<void> {
		this.calls.push("close");
	}

	query<T>(statement: string): Promise<T> {
		this.calls.push(
			statement.includes("DEFINE NAMESPACE")
				? "namespace"
				: statement.includes("DEFINE TABLE")
				? "schema"
				: "migration",
		);
		return Promise.resolve([[]] as T);
	}
}

Deno.test("SurrealConnection owns startup order and connection lifecycle", async () => {
	const driver = new RecordingDriver();
	const connection = new SurrealConnection("ws://db", "user", "pass", undefined, driver);

	await connection.initialize();
	await connection.close();

	assertEquals(driver.calls.slice(0, 4), ["connect", "namespace", "use", "schema"]);
	assertEquals(driver.calls.at(-1), "close");
});

Deno.test("SurrealConnection reports a failed boundary without swallowing it", async () => {
	const driver = new RecordingDriver();
	driver.failOnConnect = true;
	const events: string[] = [];
	const connection = new SurrealConnection(
		"ws://db",
		"user",
		"pass",
		(event) => events.push(event),
		driver,
	);

	await assertRejects(() => connection.initialize(), Error, "offline");
	assertEquals(events.includes("sdk.connect.failed"), true);
});
