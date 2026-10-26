import type { OpenFileTarget } from '../utils/openFileTarget.js';
import type { ViewerWindowEntry } from '../utils/viewerWindows.js';

/**
 * The "which window?" question for files opened from outside the app (#1029).
 *
 * Rust has already picked the window that receives the file (see
 * `OpenFileTarget`) and brought it to the front. This decides, in that
 * window, whether to load the file there as before or to ask first.
 *
 * Asking needs everything below to hold. Otherwise the file loads here, as it
 * always has:
 * - the setting is `ask`;
 * - the window has finished starting up — files given at launch are the
 *   launch's, and the launch window has always taken them;
 * - this window does not already hold the file, which would only switch to
 *   its tab;
 * - more than one window is open, so there is a choice to make.
 *
 * Explorer starts one process per selected file, so a multi-select arrives as
 * several deliveries a few milliseconds apart. They are collected for
 * `batchMs` and asked about once; any that arrive while the question is on
 * screen join it.
 *
 * Every outside dependency is passed in, as `createDocumentSession` takes
 * its, so the decision can be driven without Tauri or the viewer.
 */
export interface OpenFilePickerDeps {
	/** This window's label, the one Rust delivered the file to. */
	selfLabel: string;
	setting: () => OpenFileTarget;
	/** False until the window has taken its launch files. */
	isReady: () => boolean;
	/** Whether this window already has a tab on `path`. */
	isOpenHere: (path: string) => boolean;
	listWindows: () => Promise<ViewerWindowEntry[]>;
	openHere: (paths: string[]) => Promise<void>;
	/** Hand the files to another window and bring it to the front. */
	sendTo: (label: string, paths: string[]) => Promise<void>;
	batchMs?: number;
}

export interface OpenFilePickerState {
	show: boolean;
	paths: string[];
	windows: ViewerWindowEntry[];
	selected: number;
}

export function createOpenFilePicker(deps: OpenFilePickerDeps) {
	const batchMs = deps.batchMs ?? 250;
	const state = $state<OpenFilePickerState>({ show: false, paths: [], windows: [], selected: 0 });

	// Files collected while the batch timer runs and the window list is fetched.
	// Null when nothing is being collected.
	let collecting: string[] | null = null;

	function request(path: string) {
		if (!path) return;
		if (deps.setting() !== 'ask' || !deps.isReady() || deps.isOpenHere(path)) {
			void deps.openHere([path]);
			return;
		}
		if (state.show) {
			if (!state.paths.includes(path)) state.paths.push(path);
			return;
		}
		if (collecting) {
			if (!collecting.includes(path)) collecting.push(path);
			return;
		}
		collecting = [path];
		setTimeout(() => void ask(), batchMs);
	}

	async function ask() {
		const windows = await deps.listWindows().catch(() => [] as ViewerWindowEntry[]);
		const paths = collecting ?? [];
		collecting = null;
		if (paths.length === 0) return;
		if (windows.length < 2) {
			await deps.openHere(paths);
			return;
		}
		// Offered first: the window Rust chose, which is this one.
		const self = windows.findIndex((window) => window.label === deps.selfLabel);
		state.windows = windows;
		state.paths = paths;
		state.selected = Math.max(self, 0);
		state.show = true;
	}

	function close(): string[] {
		const paths = state.paths;
		state.show = false;
		state.paths = [];
		state.windows = [];
		return paths;
	}

	/**
	 * Open in the selected window. A window that has closed since the list was
	 * fetched is not an answer to "where should this go?", but "open it" still
	 * is, so the files load here instead — this window is the one asking, so it
	 * is still open.
	 */
	async function confirm() {
		if (!state.show) return;
		const target = state.windows[state.selected];
		const paths = close();
		if (!target || target.label === deps.selfLabel) {
			await deps.openHere(paths);
			return;
		}
		const stillOpen = (await deps.listWindows().catch(() => [] as ViewerWindowEntry[])).some(
			(window) => window.label === target.label,
		);
		if (!stillOpen) {
			await deps.openHere(paths);
			return;
		}
		await deps.sendTo(target.label, paths).catch(() => deps.openHere(paths));
	}

	/** Nothing opens and nothing is recorded, as if the file had not been opened. */
	function cancel() {
		close();
	}

	function select(index: number) {
		if (index >= 0 && index < state.windows.length) state.selected = index;
	}

	/**
	 * The list's keys, handed to `Modal` as its `onkeydown`: ↑/↓ move the
	 * selection and Home/End jump to the ends, stopping there rather than
	 * wrapping, as the folder tree does. Every other key is left to the dialog,
	 * which already answers Enter/y, Escape/n and Tab.
	 */
	function keydown(e: KeyboardEvent) {
		const last = state.windows.length - 1;
		const to =
			e.key === 'ArrowDown' ? state.selected + 1
			: e.key === 'ArrowUp' ? state.selected - 1
			: e.key === 'Home' ? 0
			: e.key === 'End' ? last
			: null;
		if (to === null) return;
		e.preventDefault();
		select(Math.min(Math.max(to, 0), last));
	}

	return { state, request, confirm, cancel, select, keydown };
}

export type OpenFilePicker = ReturnType<typeof createOpenFilePicker>;
