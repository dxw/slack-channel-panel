import {describe, it, beforeEach, afterEach, mock} from 'node:test';
import assert from 'node:assert/strict';
import {
	toChannel,
	fetchChannels,
	getChannels,
	clearChannelCache,
} from './index.js';

const slackChannel = {
	id: 'C123',
	name: 'general',
	is_archived: false,
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

/** A 429 response telling us to retry straight away. */
const rateLimited = () =>
	new Response(null, {status: 429, headers: {'Retry-After': '0'}});

afterEach(() => {
	mock.restoreAll();
});

describe('toChannel', () => {
	it('picks the fields we use', () => {
		assert.deepEqual(toChannel(slackChannel), {
			id: 'C123',
			name: 'general',
			isArchived: false,
			memberCount: 42,
			topic: 'Company-wide chat',
			purpose: 'Announcements',
			created: new Date('2020-09-13T12:26:40Z'),
		});
	});
});

describe('fetchChannels', () => {
	it('sends the token as a bearer header', async () => {
		const fetch = mock.method(globalThis, 'fetch', async () =>
			slackPage([slackChannel]),
		);

		await fetchChannels('xoxb-secret');

		const [url, options] = fetch.mock.calls[0].arguments;
		assert.equal(
			url.origin + url.pathname,
			'https://slack.com/api/conversations.list',
		);
		assert.equal(url.searchParams.get('types'), 'public_channel');
		assert.equal(options.headers.Authorization, 'Bearer xoxb-secret');
	});

	it('follows the cursor across pages', async () => {
		const fetch = mock.method(globalThis, 'fetch', async (url) =>
			url.searchParams.get('cursor') === 'page-2'
				? slackPage([{...slackChannel, id: 'C2', name: 'random'}])
				: slackPage([slackChannel], 'page-2'),
		);

		const channels = await fetchChannels('xoxb-secret');

		assert.equal(fetch.mock.callCount(), 2);
		assert.deepEqual(
			channels.map((c) => c.name),
			['general', 'random'],
		);
	});

	it('throws with the Slack error code, not the token', async () => {
		mock.method(globalThis, 'fetch', async () =>
			Response.json({ok: false, error: 'invalid_auth'}),
		);

		await assert.rejects(fetchChannels('xoxb-secret'), (error) => {
			assert.match(error.message, /invalid_auth/);
			assert.doesNotMatch(error.message, /xoxb-secret/);
			return true;
		});
	});

	it('retries when rate limited', async () => {
		let calls = 0;
		mock.method(globalThis, 'fetch', async () =>
			++calls === 1 ? rateLimited() : slackPage([slackChannel]),
		);

		const channels = await fetchChannels('xoxb-secret');

		assert.equal(calls, 2);
		assert.equal(channels.length, 1);
	});

	it('gives up after 3 retries if still rate limited', async () => {
		const fetch = mock.method(globalThis, 'fetch', async () => rateLimited());

		await assert.rejects(fetchChannels('xoxb-secret'), /rate limited/);
		// The first try plus 3 retries.
		assert.equal(fetch.mock.callCount(), 4);
	});
});

describe('getChannels', () => {
	beforeEach(() => {
		clearChannelCache();
		process.env.SLACK_BOT_TOKEN = 'xoxb-secret';
		mock.method(console, 'log', () => {});
	});

	afterEach(() => {
		delete process.env.SLACK_BOT_TOKEN;
	});

	it('caches the channels for 15 minutes', async () => {
		const fetch = mock.method(globalThis, 'fetch', async () =>
			slackPage([slackChannel]),
		);
		const start = Date.now();

		await getChannels(start);
		await getChannels(start + 14 * 60 * 1000);
		assert.equal(fetch.mock.callCount(), 1);

		await getChannels(start + 15 * 60 * 1000);
		assert.equal(fetch.mock.callCount(), 2);
	});

	it('shares one fetch between concurrent calls', async () => {
		const fetch = mock.method(globalThis, 'fetch', async () =>
			slackPage([slackChannel]),
		);

		await Promise.all([getChannels(), getChannels()]);

		assert.equal(fetch.mock.callCount(), 1);
	});

	it('throws if SLACK_BOT_TOKEN is not set', async () => {
		delete process.env.SLACK_BOT_TOKEN;

		await assert.rejects(getChannels(), /SLACK_BOT_TOKEN is not set/);
	});
});
