import { Surreal } from "surrealdb";
import { runSurrealStorageMigrations } from "./surreal_migrations.ts";
import { SURREAL_SCHEMA_DDL } from "./surreal_schema.ts";

export interface SurrealQueryClient {
	query<T>(statement: string, variables?: Record<string, unknown>): Promise<T>;
}

export interface SurrealConnectionDriver extends SurrealQueryClient {
	connect(
		endpoint: string,
		options: { authentication: { username: string; password: string } },
	): Promise<unknown>;
	use(options: { namespace: string; database: string }): Promise<unknown>;
	close(): Promise<unknown>;
}

export type SurrealDiagnosticLogger = (event: string, detail?: unknown) => void;

export class SurrealConnection implements SurrealQueryClient {
	readonly #driver: SurrealConnectionDriver;

	constructor(
		private readonly endpoint: string,
		private readonly username = "root",
		private readonly password = "root",
		private readonly diagnosticLogger?: SurrealDiagnosticLogger,
		driver: SurrealConnectionDriver = new Surreal() as SurrealConnectionDriver,
	) {
		this.trace("sdk.constructor.begin", { endpoint });
		this.#driver = driver;
		this.trace("sdk.constructor.ready", { endpoint });
	}

	async initialize(): Promise<void> {
		await this.step("sdk.connect", () =>
			this.#driver.connect(this.endpoint, {
				authentication: { username: this.username, password: this.password },
			}));
		await this.step("sdk.namespace.ensure", () =>
			this.#driver.query(`
				DEFINE NAMESPACE IF NOT EXISTS radiora_v2;
				USE NS radiora_v2;
				DEFINE DATABASE IF NOT EXISTS main;
			`));
		await this.step(
			"sdk.namespace.use",
			() => this.#driver.use({ namespace: "radiora_v2", database: "main" }),
		);
		await this.step("sdk.schema.ensure", () => this.#driver.query(SURREAL_SCHEMA_DDL));
		await this.step("sdk.schema.migrate", () => runSurrealStorageMigrations(this.#driver));
		this.trace("sdk.initialize.ready");
	}

	query<T>(statement: string, variables?: Record<string, unknown>): Promise<T> {
		return this.#driver.query<T>(statement, variables);
	}

	async close(): Promise<void> {
		await this.#driver.close();
	}

	private trace(event: string, detail?: unknown): void {
		try {
			this.diagnosticLogger?.(event, detail);
			// biome-ignore lint/plugin/noSwallowedRejection: Optional diagnostics must never change database behavior.
		} catch {
			// Diagnostics must never change database behavior.
		}
	}

	private async step<T>(event: string, operation: () => Promise<T>): Promise<T> {
		this.trace(`${event}.begin`);
		try {
			const result = await operation();
			this.trace(`${event}.ready`);
			return result;
		} catch (cause) {
			this.trace(`${event}.failed`, cause);
			throw cause;
		}
	}
}
