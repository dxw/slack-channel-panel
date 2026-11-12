import {describe, it, beforeEach, afterEach, mock} from 'node:test';
import assert from 'node:assert/strict';
import {
	refreshChannels,
	getChannelData,
	resetChannelData,
	startChannelRefresh,
	isArchivable,
	archiveChannelById,
	NotArchivableError,
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
		// The bot has joined every channel by the time we ask about one.
		'conversations.info': (params) => ({
			channel: {
				...channels.find((c) => c.id === params.get('channel')),
				is_member: true,
			},
		}),
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
			'auth.test',
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
		assert.equal(
			busy.slackUrl,
			'https://slack.com/app_redirect?channel=C1&team=T_OURS',
		);
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

describe('isArchivable', () => {
	const quietChannel = {
		isArchived: false,
		isGeneral: false,
		isMember: true,
		isExternal: false,
		hostTeamId: 'T_OURS',
		memberCount: 5,
		inactive: true,
	};

	it('is true for an inactive channel', () => {
		assert.ok(isArchivable(quietChannel, 'T_OURS'));
	});

	it('is true for an active channel with fewer than 2 members', () => {
		assert.ok(
			isArchivable(
				{...quietChannel, inactive: false, memberCount: 1},
				'T_OURS',
			),
		);
	});

	it('is false for an active channel with 2 or more members', () => {
		assert.ok(
			!isArchivable(
				{...quietChannel, inactive: false, memberCount: 2},
				'T_OURS',
			),
		);
	});

	it('is false when the bot is not in the channel', () => {
		assert.ok(!isArchivable({...quietChannel, isMember: false}, 'T_OURS'));
	});

	it('is true for a Slack Connect channel we host', () => {
		assert.ok(isArchivable({...quietChannel, isExternal: true}, 'T_OURS'));
	});

	it('is false for a Slack Connect channel another organisation hosts', () => {
		assert.ok(
			!isArchivable(
				{...quietChannel, isExternal: true, hostTeamId: 'T_THEIRS'},
				'T_OURS',
			),
		);
	});

	it('is false for a Slack Connect channel when our team is not known', () => {
		assert.ok(!isArchivable({...quietChannel, isExternal: true}, null));
	});

	it('is false for #general and archived channels', () => {
		assert.ok(!isArchivable({...quietChannel, isGeneral: true}, 'T_OURS'));
		assert.ok(!isArchivable({...quietChannel, isArchived: true}, 'T_OURS'));
	});
});

describe('archiveChannelById', () => {
	it('archives the channel in Slack and marks it archived', async () => {
		const fetch = fakeSlack({'conversations.archive': () => ({})});
		await refresh();

		await archiveChannelById({id: 'C2', token: 'xoxb-test', now});
		const quiet = getChannelData(now).channels.find((c) => c.id === 'C2');

		assert.equal(calls(fetch).at(-1), 'conversations.archive C2');
		assert.equal(quiet.isArchived, true);
		assert.equal(quiet.archivedAt.getTime(), now);
		assert.equal(quiet.activity, undefined);
		assert.equal(quiet.canArchive, false);
	});

	it('checks the channel with Slack first', async () => {
		const fetch = fakeSlack({'conversations.archive': () => ({})});
		await refresh();
		fetch.mock.resetCalls();

		await archiveChannelById({id: 'C2', token: 'xoxb-test', now});

		assert.deepEqual(calls(fetch), [
			'conversations.info C2',
			'conversations.history C2',
			'auth.test',
			'conversations.archive C2',
		]);
	});

	it('refuses a channel the dashboard does not offer to archive', async () => {
		const fetch = fakeSlack();
		await refresh();

		await assert.rejects(
			archiveChannelById({id: 'C1', token: 'xoxb-test', now}),
			NotArchivableError,
		);
		assert.ok(!calls(fetch).includes('conversations.archive C1'));
	});

	it('refuses a channel that has had a message since the last refresh', async () => {
		let newMessage = false;
		const fetch = fakeSlack({
			'conversations.history': (params) => ({
				messages: newMessage
					? [{type: 'message', user: 'U1', ts: daysAgo(0.1)}]
					: messages[params.get('channel')],
			}),
		});
		await refresh();
		newMessage = true;

		await assert.rejects(
			archiveChannelById({id: 'C2', token: 'xoxb-test', now}),
			NotArchivableError,
		);
		const quiet = getChannelData(now).channels.find((c) => c.id === 'C2');
		assert.ok(!calls(fetch).includes('conversations.archive C2'));
		assert.equal(quiet.isArchived, false);
		assert.equal(quiet.inactive, false);
		assert.equal(quiet.canArchive, false);
	});

	it('refuses a small channel that has gained members since the last refresh', async () => {
		const tiny = slackChannel('C8', 'tiny', {num_members: 2});
		const fetch = fakeSlack({
			'conversations.list': () => ({channels: [tiny], response_metadata: {}}),
			'conversations.history': () => ({messages: messages.C1}),
			'conversations.info': () => ({channel: {...tiny, num_members: 4}}),
		});
		await refresh();
		assert.equal(getChannelData(now).channels[0].canArchive, true);

		await assert.rejects(
			archiveChannelById({id: 'C8', token: 'xoxb-test', now}),
			NotArchivableError,
		);
		const [stored] = getChannelData(now).channels;
		assert.ok(!calls(fetch).includes('conversations.archive C8'));
		assert.equal(stored.memberCount, 3);
		assert.equal(stored.canArchive, false);
	});

	it('refuses if it cannot check the channel with Slack', async () => {
		const fetch = fakeSlack({
			'conversations.info': () => ({ok: false, error: 'ratelimited'}),
		});
		await refresh();

		await assert.rejects(
			archiveChannelById({id: 'C2', token: 'xoxb-test', now}),
			/ratelimited/,
		);
		assert.ok(!calls(fetch).includes('conversations.archive C2'));
	});

	it('leaves the channel active if Slack refuses', async () => {
		fakeSlack({
			'conversations.archive': () => ({ok: false, error: 'missing_scope'}),
		});
		await refresh();

		await assert.rejects(
			archiveChannelById({id: 'C2', token: 'xoxb-test', now}),
			/missing_scope/,
		);
		const quiet = getChannelData(now).channels.find((c) => c.id === 'C2');
		assert.equal(quiet.isArchived, false);
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
