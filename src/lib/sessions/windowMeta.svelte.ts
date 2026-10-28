import { commands } from '../bindings.js';
import { hasRealFilePath } from '../utils/tabFileActions.js';

type MetaSource = {
	readonly windowTag: { name: string; color: string } | null;
	readonly activeTab: { title: string } | undefined;
	readonly tabs: readonly { readonly path: string; readonly pathKey?: string }[];
};

/**
 * Keeps the backend's window registry up to date with this window's tag,
 * active title and tab count, and with the files it has open. Call during
 * component init.
 *
 * A window opened for a pinned group is entered in the registry under the
 * group's name when it is created. Reporting before it has adopted the group
 * would clear that name and let a second click open the group again, so such a
 * window starts not ready and reports from `markReady` on.
 *
 * The open files are reported from `markReady` on in every window. Until a
 * window's first report, the backend answers "which window has this file?"
 * from the snapshot the window is restoring (`file_holder`), and a report
 * sent before the restore — an empty list — would hide that snapshot while the
 * files it names are still on their way in.
 */
export function reportWindowMeta(tabManager: MetaSource, readyAtStart: boolean) {
	let ready = $state(readyAtStart);
	let filesReady = $state(false);
	$effect(() => {
		if (!ready) return;
		commands.setWindowMeta(tabManager.windowTag?.name ?? null, tabManager.windowTag?.color ?? null, tabManager.activeTab?.title ?? '', tabManager.tabs.length).catch(() => {});
	});
	$effect(() => {
		if (!filesReady) return;
		commands.setWindowFiles(openFileKeys(tabManager.tabs)).catch(() => {});
	});
	return {
		markReady: () => {
			ready = true;
			filesReady = true;
		},
	};
}

/**
 * What this window reports as its open files: the identity of each tab on a
 * real file — the filesystem's answer (`pathKey`) when the tab has one, else
 * the path as it was opened. Untitled buffers and the home tab are not files.
 */
export function openFileKeys(tabs: readonly { readonly path: string; readonly pathKey?: string }[]): string[] {
	return tabs.filter((tab) => hasRealFilePath(tab.path)).map((tab) => tab.pathKey || tab.path);
}
