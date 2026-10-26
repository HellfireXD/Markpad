<script lang="ts">
	import type { OpenFilePicker } from '../sessions/openFilePicker.svelte.js';
	import { settings } from '../stores/settings.svelte.js';
	import { t } from '../utils/i18n.js';
	import { windowDisplay } from '../utils/viewerWindows.js';

	let { picker, selfLabel } = $props<{ picker: OpenFilePicker; selfLabel: string }>();
</script>

<!--
	The open windows, named the way the tab's "Move to window" menu names them.
	The keys are `Modal`'s (see `OpenFilePicker.keydown`); a click selects and a
	double-click opens.
-->
<div class="window-picker" role="listbox" aria-label={t('modal.openFileInTitle', settings.language)}>
	{#each picker.state.windows as window, index (window.label)}
		<button
			type="button"
			class="window-option"
			class:selected={index === picker.state.selected}
			role="option"
			aria-selected={index === picker.state.selected}
			onclick={() => picker.select(index)}
			ondblclick={() => void picker.confirm()}>
			<span class="window-dot" class:untagged={!window.tag_color} style:--tag-color={window.tag_color}></span>
			<span class="window-name">{windowDisplay(window, settings.language)}</span>
			{#if window.label === selfLabel}
				<span class="window-self">({t('modal.thisWindow', settings.language)})</span>
			{/if}
		</button>
	{/each}
</div>

<style>
	.window-picker {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-top: 12px;
		max-height: 240px;
		overflow-y: auto;
	}

	.window-option {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 6px 10px;
		border: 1px solid transparent;
		border-radius: 6px;
		background: transparent;
		color: var(--color-fg-default);
		font-family: inherit;
		font-size: 14px;
		text-align: left;
		cursor: pointer;
	}

	.window-option:hover {
		background: var(--color-neutral-muted);
	}

	.window-option.selected {
		border-color: var(--color-accent-fg);
		background: var(--color-neutral-muted);
	}

	/* The tag's colour, as the title bar's pinned-tag dots draw it. */
	.window-dot {
		width: 10px;
		height: 10px;
		flex-shrink: 0;
		border-radius: 50%;
		background: var(--tag-color);
	}

	.window-dot.untagged {
		background: transparent;
		border: 1px solid var(--color-border-default);
		box-sizing: border-box;
	}

	.window-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.window-self {
		flex-shrink: 0;
		color: var(--color-fg-muted);
		font-size: 13px;
	}
</style>
