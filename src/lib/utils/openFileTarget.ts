/**
 * Which window a file opened from outside the app lands in, when more than
 * one is open (#1029).
 *
 * Rust always picks: the focused window, else the one focused last
 * (`delivery_label` in window_runtime.rs). That is still the answer for
 * `lastWindow`, and still the window that receives the file for `ask` — it
 * is the one the picker opens in, and the one it offers first, so Enter
 * keeps the old behaviour at the cost of a keystroke.
 *
 * Only files that arrive from outside go through this: a double-click in
 * Explorer or Finder, "Open with", the command line of a second launch, and
 * macOS's open event. Opening a file from inside a window already says which
 * window it is for.
 */
export type OpenFileTarget = 'lastWindow' | 'ask';

export const DEFAULT_OPEN_FILE_TARGET: OpenFileTarget = 'lastWindow';

export function isOpenFileTarget(value: unknown): value is OpenFileTarget {
	return value === 'lastWindow' || value === 'ask';
}
