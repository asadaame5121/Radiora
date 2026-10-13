import { AsyncLocalStorage } from "node:async_hooks";

/** Serialize unrelated callers while allowing operations in the current invocation. */
export class InvocationQueue {
	private readonly context = new AsyncLocalStorage<{ active: boolean }>();
	private tail: Promise<void> = Promise.resolve();

	get isCurrent(): boolean {
		return this.context.getStore()?.active === true;
	}

	async run<T>(operation: () => Promise<T>): Promise<T> {
		if (this.isCurrent) return await operation();
		const previous = this.tail;
		const gate = Promise.withResolvers<void>();
		this.tail = gate.promise;
		await previous;
		const scope = { active: true };
		try {
			return await this.context.run(scope, operation);
		} finally {
			scope.active = false;
			gate.resolve();
		}
	}
}
