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
		top: 50%;
		left: 50%;
		z-index: 1000;
		margin: 0;
		transform: translate(-50%, -50%);
	}
</style>
