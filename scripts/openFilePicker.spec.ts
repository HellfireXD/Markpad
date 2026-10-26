import assert from 'node:assert/strict';

import { test } from 'vitest';

import { createOpenFilePicker, type OpenFilePickerDeps } from '../src/lib/sessions/openFilePicker.svelte.js';
import type { OpenFileTarget } from '../src/lib/utils/openFileTarget.js';
import type { ViewerWindowEntry } from '../src/lib/utils/viewerWindows.js';

/*
 * The "which window?" question for files opened from outside the app (#1029).
 *
 * A `.spec.ts`, so `$state` in the session is the real rune. Every dependency
 * is a fake that records what it was asked to do, which is the whole of what
 * the picker decides: load here, hand to another window, or nothing at all.
 */

const BATCH_MS = 5;

function entry(label: string, number: number, tag: string | null = null): ViewerWindowEntry {
	return { label, number, tag_name: tag, tag_color: tag ? '#1a73e8' : null, active_tab_title: '', tab_count: 1 };
}

const SELF = entry('main', 1, 'Work');
const OTHER = entry('window-2', 2, 'Personal');

function wait(ms = BATCH_MS * 4) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function setup(options: {
	setting?: OpenFileTarget;
	ready?: boolean;
	openHere?: string[];
	windows?: ViewerWindowEntry[];
} = {}) {
	const opened: string[][] = [];
	const sent: Array<{ label: string; paths: string[] }> = [];
	let windows = options.windows ?? [SELF, OTHER];
	const deps: OpenFilePickerDeps = {
		selfLabel: SELF.label,
		setting: () => options.setting ?? 'ask',
		isReady: () => options.ready ?? true,
		isOpenHere: (path) => (options.openHere ?? []).includes(path),
		listWindows: async () => windows,
		openHere: async (paths) => {
			opened.push(paths);
		},
		sendTo: async (label, paths) => {
			sent.push({ label, paths });
		},
		batchMs: BATCH_MS,
	};
	const picker = createOpenFilePicker(deps);
	return {
		picker,
		opened,
		sent,
		closeWindow: (label: string) => {
			windows = windows.filter((window) => window.label !== label);
		},
	};
}

function key(name: string): KeyboardEvent {
	return new KeyboardEvent('keydown', { key: name, cancelable: true });
}

test('"Open in last window" loads the file here, as before', async () => {
	const { picker, opened } = setup({ setting: 'lastWindow' });
	picker.request('/notes/a.md');
	await wait();
	assert.deepEqual(opened, [['/notes/a.md']]);
	assert.equal(picker.state.show, false);
});

test('with one window open there is nothing to ask', async () => {
	const { picker, opened } = setup({ windows: [SELF] });
	picker.request('/notes/a.md');
	await wait();
	assert.deepEqual(opened, [['/notes/a.md']]);
	assert.equal(picker.state.show, false);
});

test('files that arrive before the launch files are taken never ask', async () => {
	const { picker, opened } = setup({ ready: false });
	picker.request('/notes/a.md');
	assert.deepEqual(opened, [['/notes/a.md']]);
	await wait();
	assert.equal(picker.state.show, false);
});

test('a file this window already holds switches to its tab instead of asking', async () => {
	const { picker, opened } = setup({ openHere: ['/notes/a.md'] });
	picker.request('/notes/a.md');
	await wait();
	assert.deepEqual(opened, [['/notes/a.md']]);
	assert.equal(picker.state.show, false);
});

test('with several windows it asks, offering this window first', async () => {
	const { picker, opened } = setup({ windows: [OTHER, SELF] });
	picker.request('/notes/a.md');
	assert.equal(picker.state.show, false, 'nothing shows until the batch closes');
	await wait();
	assert.equal(picker.state.show, true);
	assert.deepEqual(picker.state.paths, ['/notes/a.md']);
	assert.equal(picker.state.windows[picker.state.selected].label, SELF.label);
	assert.deepEqual(opened, [], 'nothing loads while the question is open');
});

test('files opened together are asked about once', async () => {
	const { picker } = setup();
	picker.request('/notes/a.md');
	picker.request('/notes/b.md');
	picker.request('/notes/a.md');
	await wait();
	assert.deepEqual(picker.state.paths, ['/notes/a.md', '/notes/b.md']);

	// One that arrives while the dialog is up joins it.
	picker.request('/notes/c.md');
	assert.deepEqual(picker.state.paths, ['/notes/a.md', '/notes/b.md', '/notes/c.md']);
});

test('confirming this window loads every file here', async () => {
	const { picker, opened, sent } = setup();
	picker.request('/notes/a.md');
	picker.request('/notes/b.md');
	await wait();
	await picker.confirm();
	assert.deepEqual(opened, [['/notes/a.md', '/notes/b.md']]);
	assert.deepEqual(sent, []);
	assert.equal(picker.state.show, false);
});

test('confirming another window hands the files to it and loads nothing here', async () => {
	const { picker, opened, sent } = setup();
	picker.request('/notes/a.md');
	await wait();
	picker.select(picker.state.windows.findIndex((window) => window.label === OTHER.label));
	await picker.confirm();
	assert.deepEqual(sent, [{ label: OTHER.label, paths: ['/notes/a.md'] }]);
	assert.deepEqual(opened, []);
});

test('a window that closed while the dialog was open gets the files back here', async () => {
	const { picker, opened, sent, closeWindow } = setup();
	picker.request('/notes/a.md');
	await wait();
	picker.select(picker.state.windows.findIndex((window) => window.label === OTHER.label));
	closeWindow(OTHER.label);
	await picker.confirm();
	assert.deepEqual(sent, []);
	assert.deepEqual(opened, [['/notes/a.md']]);
});

test('cancel opens nothing, anywhere', async () => {
	const { picker, opened, sent } = setup();
	picker.request('/notes/a.md');
	await wait();
	picker.cancel();
	assert.equal(picker.state.show, false);
	assert.deepEqual(picker.state.paths, []);
	await picker.confirm();
	assert.deepEqual(opened, []);
	assert.deepEqual(sent, []);
});

test('arrow keys move the selection and stop at the ends; other keys are the dialog\'s', async () => {
	const third = entry('window-3', 3);
	const { picker } = setup({ windows: [SELF, OTHER, third] });
	picker.request('/notes/a.md');
	await wait();
	assert.equal(picker.state.selected, 0);

	const up = key('ArrowUp');
	picker.keydown(up);
	assert.equal(picker.state.selected, 0, 'no wrapping past the top');
	assert.equal(up.defaultPrevented, true);

	picker.keydown(key('ArrowDown'));
	picker.keydown(key('ArrowDown'));
	picker.keydown(key('ArrowDown'));
	assert.equal(picker.state.selected, 2, 'no wrapping past the bottom');

	picker.keydown(key('Home'));
	assert.equal(picker.state.selected, 0);
	picker.keydown(key('End'));
	assert.equal(picker.state.selected, 2);

	// Enter/y and Escape/n are `Modal`'s, so they must reach it untouched.
	for (const name of ['Enter', 'y', 'Escape', 'n', 'Tab']) {
		const event = key(name);
		picker.keydown(event);
		assert.equal(event.defaultPrevented, false, `${name} was swallowed`);
	}
});
