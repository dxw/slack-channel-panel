import {describe, it, before, after, mock} from 'node:test';
import assert from 'node:assert/strict';

// Set test env variables. Use the development login (no Google client ID).
Object.assign(process.env, {
	NODE_ENV: 'test',
	DEV_AUTH: 'true',
	SESSION_SECRET: 'test-session-secret',
	GOOGLE_CLIENT_ID: '',
	SLACK_BOT_TOKEN: 'xoxb-test',
});

// Fake the Slack API. Other requests (to the test server) use the real fetch.
// Set `slackFails` to true to make Slack return an error.
let slackFails = false;
const DAY_SECONDS = 24 * 60 * 60;
const nowSeconds = Date.now() / 1000;
const slackResponses = {
	'conversations.list': {
		channels: [
			{
				id: 'C123',
				name: 'test-channel',
				is_archived: false,
				is_member: true,
				num_members: 3,
				topic: {value: ''},
				purpose: {value: 'A channel for tests'},
				created: 1_600_000_000,
			},
			{
				id: 'C789',
				name: 'quiet-channel',
				is_archived: false,
				is_member: true,
				num_members: 3,
				topic: {value: ''},
				purpose: {value: 'Nobody posts here'},
				created: 1_600_000_000,
			},
			{
				id: 'C456',
				name: 'old-channel',
				is_archived: true,
				num_members: 0,
				topic: {value: ''},
				purpose: {value: 'An archived channel for tests'},
				created: 1_500_000_000,
			},
			// 30 more active channels, sorted after #test-channel, so there
			// are 32 active channels across 2 pages.
			...Array.from({length: 30}, (_, i) => ({
				id: `CZ${i}`,
				name: `zz-channel-${String(i).padStart(2, '0')}`,
				is_archived: false,
				is_member: true,
				num_members: 1,
				topic: {value: ''},
				purpose: {value: ''},
				created: 1_600_000_000,
			})),
		],
		response_metadata: {next_cursor: ''},
	},
	'conversations.history C123': {
		messages: [
			{type: 'message', user: 'U1', ts: String(nowSeconds - DAY_SECONDS)},
		],
	},
	'conversations.history C789': {
		messages: [
			{type: 'message', user: 'U1', ts: String(nowSeconds - 30 * DAY_SECONDS)},
		],
	},
};
// The channel IDs sent to conversations.archive.
const archivedIds = [];
const realFetch = globalThis.fetch;
mock.method(globalThis, 'fetch', async (url, options) => {
	if (!String(url).startsWith('https://slack.com/')) {
		return realFetch(url, options);
	}
	const method = url.pathname.replace('/api/', '');
	const channel = url.searchParams.get('channel');
	if (slackFails) {
		return Response.json({ok: false, error: 'invalid_auth'});
	}
	if (method === 'conversations.archive') {
		archivedIds.push(options.body.get('channel'));
	}
	const body = slackResponses[channel ? `${method} ${channel}` : method] ?? {
		messages: [],
	};
	return Response.json({ok: true, ...body});
});

const {refreshChannels, resetChannelData} = await import('./slack/index.js');
await refreshChannels({token: 'xoxb-test', pauseMs: 0});

const {default: app} = await import('./app.js');

let server;
let baseUrl;

before(async () => {
	server = app.listen(0);
	await new Promise((resolve, reject) => {
		server.once('listening', resolve);
		server.once('error', reject);
	});
	baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
	server.close();
});

/**
 * Sends a GET request without following redirects.
 * @param {string} path
 * @param {string} [cookie]
 */
const get = (path, cookie) =>
	fetch(`${baseUrl}${path}`, {
		redirect: 'manual',
		headers: cookie ? {cookie} : {},
	});

/**
 * Sends a POST request without following redirects.
 * @param {string} path
 * @param {{body?: URLSearchParams, cookie?: string}} [options]
 */
const post = (path, {body, cookie} = {}) =>
	fetch(`${baseUrl}${path}`, {
		method: 'POST',
		redirect: 'manual',
		body,
		headers: cookie ? {cookie} : {},
	});

/**
 * Signs in through the development login form.
 * @param {string} email
 * @returns {Promise<{res: Response, cookie: string | undefined}>}
 */
const login = async (email) => {
	const res = await post('/auth/login', {body: new URLSearchParams({email})});
	const cookie = res.headers.get('set-cookie')?.split(';')[0];
	return {res, cookie};
};

describe('when signed out', () => {
	it('redirects / to the login page', async () => {
		const res = await get('/');

		assert.equal(res.status, 302);
		assert.equal(res.headers.get('location'), '/auth/login');
	});

	it('shows the login form', async () => {
		const res = await get('/auth/login');

		assert.equal(res.status, 200);
		assert.ok((await res.text()).includes('name="email"'));
	});

	it('shows the signed out page', async () => {
		const res = await get('/auth/signed-out');

		assert.equal(res.status, 200);
		assert.ok((await res.text()).includes(`Sign in again`));
	});
});

describe('when signed in', () => {
	let cookie;

	before(async () => {
		({cookie} = await login('test@dxw.com'));
	});

	it('shows active channels by default', async () => {
		const res = await get('/', cookie);
		const html = await res.text();

		assert.equal(res.status, 200);
		assert.ok(html.includes('#test-channel'));
		assert.ok(!html.includes('#old-channel'));
		assert.ok(html.includes('Sign out'));
	});

	it('shows when each channel last had a message', async () => {
		const html = await (await get('/', cookie)).text();
		// #test-channel's message, from the fixture. Formatted in London time,
		// as the page does, so it matches whatever the runner's time zone.
		const lastMessage = new Date((nowSeconds - DAY_SECONDS) * 1000);

		assert.ok(
			html.includes(
				lastMessage.toLocaleDateString('en-GB', {timeZone: 'Europe/London'}),
			),
		);
	});

	it('marks channels with no messages in 30 days as inactive', async () => {
		const html = await (await get('/', cookie)).text();
		const rowFor = (name) =>
			html.split('<tr>').find((row) => row.includes(`#${name}`));

		assert.ok(rowFor('quiet-channel').includes('Inactive'));
		assert.ok(!rowFor('test-channel').includes('Inactive'));
	});

	it('shows archived channels', async () => {
		const res = await get('/?status=archived', cookie);
		const html = await res.text();

		assert.equal(res.status, 200);
		assert.ok(html.includes('#old-channel'));
		assert.ok(!html.includes('#test-channel'));
	});
});

describe('pagination', () => {
	let cookie;

	before(async () => {
		({cookie} = await login('test@dxw.com'));
	});

	it('shows 25 channels per page', async () => {
		const html = await (await get('/', cookie)).text();

		assert.ok(html.includes('Showing 1–25 of 32 channels'));
		assert.ok(html.includes('#zz-channel-22'));
		assert.ok(!html.includes('#zz-channel-23'));
		assert.ok(html.includes('href="/?page=2"'));
	});

	it('shows the next page', async () => {
		const html = await (await get('/?page=2', cookie)).text();

		assert.ok(html.includes('Showing 26–32 of 32 channels'));
		assert.ok(html.includes('#zz-channel-29'));
		assert.ok(!html.includes('#test-channel'));
		assert.ok(html.includes('href="/"'));
	});
});

describe('sorting', () => {
	let cookie;

	before(async () => {
		({cookie} = await login('test@dxw.com'));
	});

	it('sorts by name A–Z by default', async () => {
		const html = await (await get('/', cookie)).text();

		assert.ok(html.indexOf('#quiet-channel') < html.indexOf('#test-channel'));
	});

	it('sorts by most messages first', async () => {
		const html = await (await get('/?sort=messages&dir=desc', cookie)).text();

		// #test-channel has 1 message in the last 30 days; #quiet-channel has none.
		assert.ok(html.indexOf('#test-channel') < html.indexOf('#quiet-channel'));
		assert.ok(html.includes('aria-sort="descending"'));
	});

	it('keeps the sort when changing page', async () => {
		const html = await (await get('/?sort=messages&dir=desc', cookie)).text();

		assert.ok(html.includes('href="/?sort=messages&amp;dir=desc&amp;page=2"'));
	});
});

describe('when Slack fails', () => {
	let cookie;

	before(async () => {
		({cookie} = await login('test@dxw.com'));
		slackFails = true;
		resetChannelData();
		await refreshChannels({token: 'xoxb-test', pauseMs: 0});
	});

	after(async () => {
		slackFails = false;
		resetChannelData();
		await refreshChannels({token: 'xoxb-test', pauseMs: 0});
	});

	it('shows an error with a 502 status', async () => {
		const res = await get('/', cookie);

		assert.equal(res.status, 502);
		assert.ok(
			(await res.text()).includes('Couldn’t load channels from Slack.'),
		);
	});
});

describe('signing out', () => {
	it('ends the session', async () => {
		const {cookie} = await login('test@dxw.com');

		const res = await post('/auth/logout', {cookie});
		assert.equal(res.status, 302);
		assert.equal(res.headers.get('location'), '/auth/signed-out');

		const home = await get('/', cookie);
		assert.equal(home.status, 302);
		assert.equal(home.headers.get('location'), '/auth/login');
	});
});

describe('archiving a channel', () => {
	let cookie;
	// The table row for a channel. Skips everything before the first row, so
	// a message like "#name archived." above the table isn't mistaken for one.
	const rowFor = (html, name) =>
		html
			.split('<tr>')
			.slice(1)
			.find((row) => row.includes(`#${name}`));

	before(async () => {
		({cookie} = await login('test@dxw.com'));
	});

	after(async () => {
		resetChannelData();
		await refreshChannels({token: 'xoxb-test', pauseMs: 0});
	});

	it('offers to archive inactive channels and ones with fewer than 2 members', async () => {
		const html = await (await get('/', cookie)).text();

		assert.ok(rowFor(html, 'quiet-channel').includes('/channels/C789/archive'));
		assert.ok(rowFor(html, 'zz-channel-00').includes('/channels/CZ0/archive'));
		assert.ok(!rowFor(html, 'test-channel').includes('Archive'));
	});

	it('asks to confirm first', async () => {
		const res = await get('/channels/C789/archive', cookie);
		const html = await res.text();

		assert.equal(res.status, 200);
		assert.ok(html.includes('Archive #quiet-channel?'));
		assert.ok(html.includes('action="/channels/C789/archive"'));
	});

	it('does not offer to archive an active channel', async () => {
		const res = await get('/channels/C123/archive', cookie);

		assert.equal(res.status, 404);
	});

	it('refuses to archive an active channel', async () => {
		const res = await post('/channels/C123/archive', {cookie});

		assert.equal(res.status, 404);
		assert.ok(!archivedIds.includes('C123'));
	});

	it('archives the channel and moves it to the Archived tab', async () => {
		const res = await post('/channels/C789/archive', {cookie});
		assert.equal(res.status, 302);
		assert.equal(res.headers.get('location'), '/');
		assert.deepEqual(archivedIds, ['C789']);

		const active = await (await get('/', cookie)).text();
		assert.ok(active.includes('#quiet-channel archived.'));
		assert.ok(!rowFor(active, 'quiet-channel'));

		const archived = await (await get('/?status=archived', cookie)).text();
		assert.ok(archived.includes('#quiet-channel'));
	});

	it('shows the message only once', async () => {
		const html = await (await get('/', cookie)).text();

		assert.ok(!html.includes('#quiet-channel archived.'));
	});
});
