import {describe, it, afterEach, mock} from 'node:test';
import assert from 'node:assert/strict';
import {
	toChannel,
	callSlack,
	listChannels,
	joinChannel,
	fetchRecentMessages,
} from './api.js';

const slackChannel = {
	id: 'C123',
	name: 'general',
	is_archived: false,
	is_member: false,
	num_members: 42,
	topic: {value: 'Company-wide chat'},
	purpose: {value: 'Announcements'},
	created: 1_600_000_000,
};

/**
 * Builds a fake conversations.list response.
 * @param {object[]} channels
 * @param {string} [nextCursor]
 */
const slackPage = (channels, nextCursor = '') =>
	Response.json({
		ok: true,
		channels,
		response_metadata: {next_cursor: nextCursor},
	});

afterEach(() => {
	mock.restoreAll();
});

describe('toChannel', () => {
	it('picks the fields we use', () => {
		assert.deepEqual(toChannel(slackChannel), {
			id: 'C123',
			name: 'general',
			isArchived: false,
			isMember: false,
			memberCount: 42,
			topic: 'Company-wide chat',
			purpose: 'Announcements',
			created: new Date('2020-09-13T12:26:40Z'),
		});
	});

	it('does not count our bot as a member', () => {
		assert.equal(toChannel({...slackChannel, is_member: true}).memberCount, 41);
	});
});

describe('callSlack', () => {
	it('sends the token as a bearer header', async () => {
		const fetch = mock.method(globalThis, 'fetch', async () =>
			Response.json({ok: true}),
		);

		await callSlack('auth.test', {}, 'xoxb-secret');

		const [url, options] = fetch.mock.calls[0].arguments;
		assert.equal(url.href, 'https://slack.com/api/auth.test');
		assert.equal(options.headers.Authorization, 'Bearer xoxb-secret');
	});

	it('throws with the Slack error code, not the token', async () => {
		mock.method(globalThis, 'fetch', async () =>
			Response.json({ok: false, error: 'invalid_auth'}),
		);

		await assert.rejects(callSlack('auth.test', {}, 'xoxb-secret'), (error) => {
			assert.match(error.message, /invalid_auth/);
			assert.doesNotMatch(error.message, /xoxb-secret/);
			return true;
		});
	});

	it('waits and retries when rate limited', async () => {
		let calls = 0;
		mock.method(globalThis, 'fetch', async () =>
			++calls === 1
				? new Response(null, {status: 429, headers: {'Retry-After': '0'}})
				: Response.json({ok: true, value: 'second try'}),
		);

		const body = await callSlack('auth.test', {}, 'xoxb-secret');

		assert.equal(calls, 2);
		assert.equal(body.value, 'second try');
	});
});

describe('callSlack when rate limited', () => {
	it('gives up after 3 retries', async () => {
		const fetch = mock.method(
			globalThis,
			'fetch',
			async () =>
				new Response(null, {status: 429, headers: {'Retry-After': '0'}}),
		);

		await assert.rejects(
			callSlack('auth.test', {}, 'xoxb-secret'),
			/still rate limited after 3 retries/,
		);
		// The first try plus 3 retries.
		assert.equal(fetch.mock.callCount(), 4);
	});
});

describe('listChannels', () => {
	it('lists public channels, following the cursor across pages', async () => {
		const fetch = mock.method(globalThis, 'fetch', async (url) =>
			url.searchParams.get('cursor') === 'page-2'
				? slackPage([{...slackChannel, id: 'C2', name: 'random'}])
				: slackPage([slackChannel], 'page-2'),
		);

		const channels = await listChannels('xoxb-secret');

		assert.equal(fetch.mock.callCount(), 2);
		const [url] = fetch.mock.calls[0].arguments;
		assert.equal(url.pathname, '/api/conversations.list');
		assert.equal(url.searchParams.get('types'), 'public_channel');
		assert.deepEqual(
			channels.map((c) => c.name),
			['general', 'random'],
		);
	});
});

describe('joinChannel', () => {
	it('POSTs the channel ID to conversations.join', async () => {
		const fetch = mock.method(globalThis, 'fetch', async () =>
			Response.json({ok: true}),
		);

		await joinChannel('xoxb-secret', 'C123');

		const [url, options] = fetch.mock.calls[0].arguments;
		assert.equal(url.pathname, '/api/conversations.join');
		assert.equal(options.method, 'POST');
		assert.equal(options.body.get('channel'), 'C123');
	});
});

describe('fetchRecentMessages', () => {
	it('returns the latest 100 messages', async () => {
		const messages = [{type: 'message', ts: '1700000000.000100'}];
		const fetch = mock.method(globalThis, 'fetch', async () =>
			Response.json({ok: true, messages}),
		);

		assert.deepEqual(
			await fetchRecentMessages('xoxb-secret', 'C123'),
			messages,
		);

		const [url] = fetch.mock.calls[0].arguments;
		assert.equal(url.pathname, '/api/conversations.history');
		assert.equal(url.searchParams.get('channel'), 'C123');
		assert.equal(url.searchParams.get('limit'), '100');
	});
});
