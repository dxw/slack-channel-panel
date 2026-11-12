import {describe, it, beforeEach, afterEach, mock} from 'node:test';
import assert from 'node:assert/strict';
import {
	refreshChannels,
	getChannelData,
	resetChannelData,
	startChannelRefresh,
} from './index.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const now = Date.parse('2026-11-10T12:00:00Z');
const daysAgo = (days) => String((now - days * DAY_MS) / 1000);

/** @type {(id: string, name: string, extra?: object) => object} */
const slackChannel = (id, name, extra = {}) => ({
	id,
	name,
	is_archived: false,
	is_member: true,
	num_members: 5,
	topic: {value: ''},
	purpose: {value: ''},
	created: 1_600_000_000,
	...extra,
});

const channels = [
	slackChannel('C1', 'busy'),
	slackChannel('C2', 'quiet', {is_member: false}),
	slackChannel('C3', 'archived', {is_archived: true}),
];

const messages = {
	C1: [{type: 'message', user: 'U1', ts: daysAgo(1)}],
	C2: [{type: 'message', user: 'U1', ts: daysAgo(30)}],
};

/**
 * Fakes the Slack API, answering by method name.
 * @param {Record<string, (params: URLSearchParams) => object>} [overrides]
 */
const fakeSlack = (overrides = {}) => {
	const handlers = {
		'auth.test': () => ({team_id: 'T_OURS'}),
		'conversations.list': () => ({channels, response_metadata: {}}),
		'conversations.join': () => ({}),
		'conversations.history': (params) => ({
			messages: messages[params.get('channel')],
		}),
		...overrides,
	};
	return mock.method(globalThis, 'fetch', async (url, options) => {
		const method = url.pathname.replace('/api/', '');
		const params = options.body ?? url.searchParams;
		return Response.json({ok: true, ...handlers[method](params)});
	});
};

/**
 * The Slack methods called, in order, with the channel ID if any.
 * @param {any} fetch
 */
const calls = (fetch) =>
	fetch.mock.calls.map(({arguments: [url, options]}) => {
		const channel = (options.body ?? url.searchParams).get('channel');
		return [url.pathname.replace('/api/', ''), channel]
			.filter(Boolean)
			.join(' ');
	});

const refresh = ({joinChannels = true} = {}) =>
	refreshChannels({
		token: 'xoxb-test',
		joinChannels,
		pauseMs: 0,
		now: () => now,
	});

beforeEach(() => {
	resetChannelData();
	mock.method(console, 'log', () => {});
	mock.method(console, 'warn', () => {});
	mock.method(console, 'error', () => {});
});

afterEach(() => {
	mock.restoreAll();
});

describe('refreshChannels', () => {
	it('joins channels the bot is not in, and skips archived channels', async () => {
		const fetch = fakeSlack();

		await refresh();

		assert.deepEqual(calls(fetch), [
			'conversations.list',
			'auth.test',
			'conversations.history C1',
			'conversations.join C2',
			'conversations.history C2',
		]);
	});

	it('only joins Slack Connect channels hosted by our own organisation', async () => {
		const fetch = fakeSlack({
			'conversations.list': () => ({
				channels: [
					slackChannel('C4', 'hosted-by-us', {
						is_member: false,
						is_ext_shared: true,
						conversation_host_id: 'T_OURS',
					}),
					slackChannel('C5', 'hosted-elsewhere', {
						is_member: false,
						is_ext_shared: true,
						conversation_host_id: 'T_THEIRS',
					}),
					slackChannel('C6', 'no-host-given', {
						is_member: false,
						is_ext_shared: true,
					}),
					slackChannel('C7', 'elsewhere-member', {
						is_ext_shared: true,
						conversation_host_id: 'T_THEIRS',
					}),
				],
				response_metadata: {},
			}),
			'conversations.history': () => ({messages: []}),
		});

		await refresh({joinChannels: true});

		assert.deepEqual(calls(fetch), [
			'conversations.list',
			'auth.test',
			'conversations.join C4',
			'conversations.history C4',
			'conversations.history C7',
		]);
	});

	it('does not join channels when joining is turned off', async () => {
		const fetch = fakeSlack();

		await refresh({joinChannels: false});
		const [, quiet] = getChannelData(now).channels;

		assert.deepEqual(calls(fetch), [
			'conversations.list',
			'conversations.history C1',
		]);
		assert.equal(quiet.activity, undefined);
		assert.equal(quiet.inactive, false);
	});

	it('does not join channels unless SLACK_JOIN_CHANNELS=true', async () => {
		const fetch = fakeSlack();

		await refreshChannels({token: 'xoxb-test', pauseMs: 0});

		assert.ok(!calls(fetch).includes('conversations.join C2'));
	});

	it('stores each channel with its activity', async () => {
		fakeSlack();

		await refresh();
		const data = getChannelData(now);

		assert.equal(data.refreshedAt.getTime(), now);
		assert.equal(data.refreshing, false);
		assert.deepEqual(data.progress, {done: 2, total: 2});

		const [busy, quiet, archived] = data.channels;
		assert.deepEqual(busy.activity, {
			lastMessageAt: new Date(now - DAY_MS),
			messagesLastMonth: 1,
		});
		assert.equal(busy.inactive, false);
		assert.equal(quiet.inactive, true);
		assert.equal(archived.activity, undefined);
		assert.equal(archived.inactive, false);
	});

	it('carries on if one channel fails', async () => {
		fakeSlack({
			'conversations.history': (params) =>
				params.get('channel') === 'C1'
					? {ok: false, error: 'not_in_channel'}
					: {messages: messages.C2},
		});

		await refresh();
		const [busy, quiet] = getChannelData(now).channels;

		assert.equal(busy.activity, undefined);
		assert.equal(quiet.activity.messagesLastMonth, 0);
	});

	it('keeps the previous channels if listing fails', async () => {
		fakeSlack();
		await refresh();

		mock.restoreAll();
		mock.method(console, 'error', () => {});
		fakeSlack({
			'conversations.list': () => ({ok: false, error: 'invalid_auth'}),
		});
		await refresh();
		const data = getChannelData(now);

		assert.equal(data.channels.length, 3);
		assert.match(data.error, /invalid_auth/);
	});
});

describe('startChannelRefresh', () => {
	afterEach(() => {
		delete process.env.SLACK_FAKE_DATA;
	});

	it('uses made-up channels without calling Slack when SLACK_FAKE_DATA=true', () => {
		process.env.SLACK_FAKE_DATA = 'true';
		const fetch = mock.method(globalThis, 'fetch', async () => {
			throw new Error('should not call Slack');
		});

		startChannelRefresh();
		const data = getChannelData();

		assert.ok(data.channels.length > 0);
		assert.ok(data.channels.some((channel) => channel.inactive));
		assert.equal(fetch.mock.callCount(), 0);
	});
});
