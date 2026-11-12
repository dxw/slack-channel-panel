import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {sortChannels} from './sorting.js';

/** @type {(name: string, extra?: object) => object} */
const channel = (name, extra = {}) => ({
	name,
	memberCount: 0,
	isMember: true,
	inactive: false,
	activity: undefined,
	archivedAt: null,
	...extra,
});

const activity = (messagesLastMonth, lastMessageAt) => ({
	messagesLastMonth,
	lastMessageAt,
});

const names = (channels) => channels.map((c) => c.name);

describe('sortChannels', () => {
	it('sorts by name A–Z and Z–A', () => {
		const channels = [channel('b'), channel('c'), channel('a')];

		assert.deepEqual(names(sortChannels(channels, 'name', 'asc')), [
			'a',
			'b',
			'c',
		]);
		assert.deepEqual(names(sortChannels(channels, 'name', 'desc')), [
			'c',
			'b',
			'a',
		]);
	});

	it('sorts by number of messages, highest or lowest first', () => {
		const channels = [
			channel('few', {activity: activity(2, new Date())}),
			channel('lots', {activity: activity(50, new Date())}),
			channel('none', {activity: activity(0, null)}),
		];

		assert.deepEqual(names(sortChannels(channels, 'messages', 'desc')), [
			'lots',
			'few',
			'none',
		]);
		assert.deepEqual(names(sortChannels(channels, 'messages', 'asc')), [
			'none',
			'few',
			'lots',
		]);
	});

	it('puts channels with unknown activity last, whichever direction', () => {
		const channels = [
			channel('unknown'),
			channel('known', {activity: activity(1, new Date())}),
		];

		assert.deepEqual(names(sortChannels(channels, 'messages', 'asc')), [
			'known',
			'unknown',
		]);
		assert.deepEqual(names(sortChannels(channels, 'messages', 'desc')), [
			'known',
			'unknown',
		]);
	});

	it('sorts channels nobody has posted in as the oldest last message', () => {
		const channels = [
			channel('never', {activity: activity(0, null)}),
			channel('recent', {activity: activity(1, new Date('2026-11-10'))}),
			channel('old', {activity: activity(0, new Date('2026-01-01'))}),
		];

		assert.deepEqual(names(sortChannels(channels, 'lastMessage', 'desc')), [
			'recent',
			'old',
			'never',
		]);
	});

	it('sorts empty, then inactive channels first by status', () => {
		const channels = [
			channel('active', {memberCount: 3, activity: activity(3, new Date())}),
			channel('not-in', {memberCount: 3, isMember: false}),
			channel('inactive', {
				memberCount: 3,
				inactive: true,
				activity: activity(0, null),
			}),
			channel('empty', {inactive: true, activity: activity(0, null)}),
		];

		assert.deepEqual(names(sortChannels(channels, 'status', 'asc')), [
			'empty',
			'inactive',
			'active',
			'not-in',
		]);
	});

	it('sorts channels that can be archived first', () => {
		const channels = [
			channel('a'),
			channel('b', {canArchive: true}),
			channel('c'),
		];

		assert.deepEqual(names(sortChannels(channels, 'archive', 'asc')), [
			'b',
			'a',
			'c',
		]);
		assert.deepEqual(names(sortChannels(channels, 'archive', 'desc')), [
			'a',
			'c',
			'b',
		]);
	});

	it('sorts by name when values are equal', () => {
		const channels = [
			channel('b', {memberCount: 5}),
			channel('a', {memberCount: 5}),
		];

		assert.deepEqual(names(sortChannels(channels, 'members', 'desc')), [
			'a',
			'b',
		]);
	});

	it('does not change the original array', () => {
		const channels = [channel('b'), channel('a')];

		sortChannels(channels, 'name', 'asc');

		assert.deepEqual(names(channels), ['b', 'a']);
	});
});
