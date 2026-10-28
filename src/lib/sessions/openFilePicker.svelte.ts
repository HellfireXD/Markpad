import type { OpenFileTarget } from '../utils/openFileTarget.js';
import type { ViewerWindowEntry } from '../utils/viewerWindows.js';

/**
 * The "which window?" question for files opened from outside the app (#1029).
 *
 * Rust has already sent a file that is open in some window to that window
 * (`file_holder` in window_runtime.rs), so a file that reaches this question
 * is open nowhere, or already open here. Rust has picked the window that
 * receives it (see `OpenFileTarget`) and brought it to the front. This decides,
 * in that window, whether to load the file there as before or to ask first.
 *
 * It asks when all of these hold. Otherwise the file loads here, as it always
 * has:
 * - the setting is `ask`;
 * - this window does not already have the file, which would only switch to
 *   its tab — a launch file this window is restoring itself, say;
 * - more than one window is open, so there is a choice to make.
 *
 * Nothing is asked before `markReady`, which is once every window of the
 * launch has restored (`windows-restored`), so the list is complete and the
 * launch files that a reopened window has open have gone to it. Files that
 * arrive before then wait and are asked about together.
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
	/** Whether this window already has a tab on `path`. */
	isOpenHere: (path: string) => boolean;
	listWindows: () => Promise<ViewerWindowEntry[]>;
	openHere: (paths: string[]) => Promise<void>;
	/** Hand the files to another window and bring it to the front. */
	sendTo: (label: string, paths: string[]) => Promise<void>;
	/**
	 * Keep this window in front of the other Markpad windows while the
	 * question is on screen (`true`), or let it go (`false`). At launch the
	 * reopened windows come up over the launch window after Rust delivered to
	 * it, and the picker would open hidden behind them.
	 */
	holdFront: (held: boolean) => Promise<void>;
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

	let ready = false;
	// Files that arrived before `markReady`.
	let waiting: string[] = [];
	// Files collected while the batch timer runs and the window list is fetched.
	// Null when nothing is being collected.
	let collecting: string[] | null = null;
	// Opens run one after another, in the order they were decided, as the
	// launch's files always have (`openFiles`).
	let opening: Promise<void> = Promise.resolve();

	function openHere(paths: string[]): Promise<void> {
		opening = opening.then(() => deps.openHere(paths)).catch(() => {});
		return opening;
	}

	function request(path: string) {
		if (!path) return;
		if (deps.setting() !== 'ask' || deps.isOpenHere(path)) {
			void openHere([path]);
			return;
		}
		// Joins the files waiting for `markReady`, the question on screen, or
		// the batch being collected, in that order. Otherwise it starts a batch.
		const joining = !ready ? waiting : state.show ? state.paths : collecting;
		if (joining) {
			if (!joining.includes(path)) joining.push(path);
			return;
		}
		collecting = [path];
		setTimeout(() => void ask(), batchMs);
	}

	/** Asks about the files that waited, and every later one. Once is enough. */
	function markReady() {
		if (ready) return;
		ready = true;
		const paths = waiting;
		waiting = [];
		for (const path of paths) request(path);
	}

	async function ask() {
		const windows = await deps.listWindows().catch(() => [] as ViewerWindowEntry[]);
		const paths = collecting ?? [];
		collecting = null;
		if (paths.length === 0) return;
		if (windows.length < 2) {
			await openHere(paths);
			return;
		}
		// Offered first: the window Rust chose, which is this one.
		const self = windows.findIndex((window) => window.label === deps.selfLabel);
		state.windows = windows;
		state.paths = paths;
		state.selected = Math.max(self, 0);
		state.show = true;
		await deps.holdFront(true).catch(() => {});
	}

	function close(): string[] {
		const paths = state.paths;
		if (state.show) void deps.holdFront(false).catch(() => {});
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
		const elsewhere =
			target &&
			target.label !== deps.selfLabel &&
			(await deps.listWindows().catch(() => [] as ViewerWindowEntry[])).some((window) => window.label === target.label);
		if (!elsewhere) {
			await openHere(paths);
			return;
		}
		await deps.sendTo(target.label, paths).catch(() => openHere(paths));
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

	return { state, request, markReady, confirm, cancel, select, keydown };
}

export type OpenFilePicker = ReturnType<typeof createOpenFilePicker>;
