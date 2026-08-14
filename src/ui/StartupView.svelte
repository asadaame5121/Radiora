<script lang="ts">
	import type { StartupStatus } from "../shared/bindings.ts";

	let {
		startup,
		onRetry,
	}: {
		startup: StartupStatus;
		onRetry: () => void | Promise<void>;
	} = $props();
</script>

<main class="app-main startup-main">
	<section class="startup-card" aria-live="polite">
		<div class:failed={startup.phase === "failed"} class="startup-indicator"></div>
		<p class="eyebrow">{startup.phase === "failed" ? "STARTUP FAILED" : "STARTING"}</p>
		<h1>{startup.message}</h1>
		{#if startup.detail}<p class="startup-detail">{startup.detail}</p>{/if}
		{#if startup.logPath}<p class="startup-log">診断ログ: <code>{startup.logPath}</code></p>{/if}
		{#if startup.phase === "failed"}<button class="retry" onclick={onRetry}>再試行</button>{/if}
	</section>
</main>

<style>
	.startup-main {
		display: grid;
		place-items: center;
		height: 100%;
	}
	.startup-card {
		width: min(620px, calc(100vw - 48px));
		padding: 42px;
		border: 1px solid var(--border);
		border-radius: 14px;
		background: var(--surface-raised);
		box-shadow: 0 24px 80px #0008;
	}
	.startup-card h1 {
		margin: 8px 0 18px;
		font-family: Georgia, serif;
		font-size: 25px;
		font-weight: normal;
		color: #edf9fa;
	}
	.startup-indicator {
		width: 12px;
		height: 12px;
		margin-bottom: 20px;
		border-radius: 50%;
		background: var(--cyan);
		box-shadow: 0 0 0 0 rgb(37 198 209 / 50%);
		animation: startup-pulse 1.4s infinite;
	}
	.startup-indicator.failed {
		background: #d77b6d;
		animation: none;
	}
	.startup-detail {
		padding: 12px 14px;
		border: 1px solid #71433d;
		border-radius: 6px;
		background: #3c2421;
		color: #ffb8af;
		white-space: pre-wrap;
	}
	.startup-log {
		color: var(--muted);
		font-size: 12px;
		overflow-wrap: anywhere;
	}
	.startup-log code {
		color: var(--text);
	}
	.retry {
		margin-top: 14px;
		padding: 9px 18px;
		border: 1px solid var(--border-bright);
		border-radius: 7px;
		background: var(--surface-hover);
		color: var(--text);
		cursor: pointer;
	}
	@keyframes startup-pulse {
		70% {
			box-shadow: 0 0 0 12px #a5b79000;
		}
		100% {
			box-shadow: 0 0 0 0 #a5b79000;
		}
	}
</style>
