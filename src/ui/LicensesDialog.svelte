<script lang="ts">
	import { Dialog } from "bits-ui";

	export type LicenseEntry = {
		name: string;
		version: string;
		license: string;
		file: string | null;
		summary: string;
	};

	export type LicenseIndex = {
		runtime: LicenseEntry[];
		npm: LicenseEntry[];
	};

	let {
		open = $bindable(),
		licenseIndex,
		licenseDetail,
		licenseError,
		licenseLoading,
		onSelectLicense,
	}: {
		open: boolean;
		licenseIndex: LicenseIndex | null;
		licenseDetail: { name: string; text: string } | null;
		licenseError: string;
		licenseLoading: boolean;
		onSelectLicense: (entry: LicenseEntry) => void | Promise<void>;
	} = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay>
			{#snippet child({ props })}
				<div {...props} class="licenses-dialog__overlay"></div>
			{/snippet}
		</Dialog.Overlay>
		<Dialog.Content>
			{#snippet child({ props })}
				<div {...props} role="dialog" class="licenses-dialog" aria-labelledby="licenses-title">
					<div class="licenses-dialog__content">
						<header class="licenses-dialog__header">
							<p class="eyebrow">THIRD-PARTY NOTICES</p>
							<Dialog.Title>
								{#snippet child({ props: titleProps })}
									<h2 {...titleProps} id="licenses-title">ライセンス情報</h2>
								{/snippet}
							</Dialog.Title>
							<Dialog.Description>
								{#snippet child({ props: descriptionProps })}
									<p {...descriptionProps} id="licenses-description">
										Radioraが利用しているサードパーティソフトウェアのライセンスを表示します。
									</p>
								{/snippet}
							</Dialog.Description>
						</header>
						{#if licenseError}
							<p class="licenses-dialog__error" role="alert">{licenseError}</p>
						{:else if licenseIndex}
							<div class="licenses-dialog__layout">
								<ul class="licenses-dialog__list">
									{#each [...licenseIndex.runtime, ...licenseIndex.npm] as entry}
										<li>
											<button type="button" onclick={() => onSelectLicense(entry)}>
												<strong>{entry.name}</strong>
												<small>{entry.license}{entry.version ? ` · ${entry.version}` : ""}</small>
												</button>
										</li>
									{/each}
								</ul>
								<div class="licenses-dialog__detail">
									{#if licenseDetail}
										<h3>{licenseDetail.name}</h3>
										<pre>{licenseDetail.text}</pre>
									{:else}
										<p class="licenses-dialog__hint">左の一覧からライセンスを選択してください。</p>
									{/if}
								</div>
							</div>
						{:else if licenseLoading}
							<p>読み込んでいます…</p>
						{/if}
						<div class="licenses-dialog__actions">
							<Dialog.Close>
								{#snippet child({ props })}
									<button {...props} type="button">閉じる</button>
								{/snippet}
							</Dialog.Close>
						</div>
					</div>
				</div>
			{/snippet}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<style>
	.licenses-dialog__overlay {
		position: fixed;
		inset: 0;
		z-index: 999;
		background: rgb(0 0 0 / 64%);
		backdrop-filter: blur(3px);
	}

	.licenses-dialog {
		position: fixed;
		inset: 0;
		margin: auto;
		z-index: 1000;
		width: min(880px, calc(100vw - 48px));
		height: min(640px, calc(100vh - 96px));
		border: 1px solid var(--border-bright);
		border-radius: 10px;
		padding: 0;
		background: var(--surface-raised);
		color: var(--text);
		box-shadow: 0 24px 80px #000c;
	}

	.licenses-dialog__content {
		display: flex;
		flex-direction: column;
		height: 100%;
		padding: 24px;
		box-sizing: border-box;
	}

	.licenses-dialog__header h2 {
		margin: 8px 0;
		font: normal 20px/1.4 var(--font-serif);
		color: #edf9fa;
	}

	.licenses-dialog__header p:not(.eyebrow) {
		margin: 0;
		font-size: 13px;
		color: #afc1c9;
		line-height: 1.6;
	}

	.licenses-dialog__layout {
		display: grid;
		grid-template-columns: 280px 1fr;
		gap: 16px;
		flex: 1;
		min-height: 0;
		margin-top: 16px;
	}

	.licenses-dialog__list {
		overflow-y: auto;
		margin: 0;
		padding: 0;
		list-style: none;
		border: 1px solid var(--border);
		border-radius: 8px;
	}

	.licenses-dialog__list li {
		border-bottom: 1px solid var(--border);
	}

	.licenses-dialog__list li:last-child {
		border-bottom: none;
	}

	.licenses-dialog__list button {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		width: 100%;
		padding: 8px 12px;
		border: none;
		background: transparent;
		color: var(--text);
		cursor: pointer;
		text-align: left;
	}

	.licenses-dialog__list button:hover {
		background: var(--surface-hover);
	}

	.licenses-dialog__list small {
		color: #afc1c9;
	}

	.licenses-dialog__detail {
		overflow-y: auto;
		padding: 12px 16px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface);
	}

	.licenses-dialog__detail h3 {
		margin: 0 0 8px;
		font-size: 14px;
	}

	.licenses-dialog__detail pre {
		margin: 0;
		white-space: pre-wrap;
		word-break: break-word;
		font-size: 12px;
		line-height: 1.55;
		color: #c7d5da;
	}

	.licenses-dialog__hint {
		margin: 0;
		color: #afc1c9;
		font-size: 13px;
	}

	.licenses-dialog__error {
		color: #ffd2cd;
	}

	.licenses-dialog__actions {
		display: flex;
		justify-content: flex-end;
		margin-top: 14px;
	}

	.licenses-dialog__actions button {
		padding: 8px 16px;
	}
</style>
