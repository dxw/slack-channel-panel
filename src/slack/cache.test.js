import {describe, it, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {saveCache, loadCache} from './cache.js';

let dir;
let file;

beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), 'channel-cache-'));
	file = path.join(dir, 'nested', 'channels.json');
});

afterEach(() => {
	fs.rmSync(dir, {recursive: true, force: true});
});

const data = {
	channels: [
		{
			id: 'C1',
			name: 'busy',
			created: new Date('2020-09-13T12:26:40Z'),
			archivedAt: null,
			sharedTeamIds: ['T_THEIRS'],
		},
		{
			id: 'C2',
			name: 'old',
			created: new Date('2019-01-01T00:00:00Z'),
			archivedAt: new Date('2025-06-01T00:00:00Z'),
			sharedTeamIds: [],
		},
	],
	activity: new Map([
		[
			'C1',
			{lastMessageAt: new Date('2026-11-09T12:00:00Z'), messagesLastMonth: 3},
		],
		['C3', {lastMessageAt: null, messagesLastMonth: 0}],
	]),
	teamNames: new Map([['T_THEIRS', 'Partner Co']]),
	ownTeamId: 'T_OURS',
	refreshedAt: new Date('2026-11-10T12:00:00Z'),
};

describe('saveCache and loadCache', () => {
	it('saves the data and loads it back, with its dates', () => {
		saveCache(file, data);

		assert.deepEqual(loadCache(file), data);
	});

	it('returns null when there is no file', () => {
		assert.equal(loadCache(file), null);
	});

	it('returns null when the file is not valid JSON', () => {
		fs.mkdirSync(path.dirname(file), {recursive: true});
		fs.writeFileSync(file, 'not json');

		assert.equal(loadCache(file), null);
	});

	it('returns null for a file saved in an older format', () => {
		fs.mkdirSync(path.dirname(file), {recursive: true});
		fs.writeFileSync(file, JSON.stringify({version: 0, channels: []}));

		assert.equal(loadCache(file), null);
	});
});
