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
	// Active, but archivable as it has only 1 member.
	'conversations.history CZ0': {
		messages: [
			{type: 'message', user: 'U1', ts: String(nowSeconds - DAY_SECONDS)},
		],
	},
	// Checked again with Slack just before archiving.
	'conversations.info C789': {
		channel: {
			id: 'C789',
			name: 'quiet-channel',
			is_archived: false,
			is_member: true,
			num_members: 3,
			topic: {value: ''},
			purpose: {value: 'Nobody posts here'},
			created: 1_600_000_000,
		},
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

const {refreshChannels, resetChannelData, waitForBulkArchive} =
	await import('./slack/index.js');
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

/**
 * The rows sent for the channels grid, from the page's #channel-data.
 * @param {string} html
 * @returns {any[]}
 */
const rowsOf = (html) => {
	const json = html.match(
		/<script type="application\/json" id="channel-data">(.*?)<\/script>/s,
	)?.[1];
	assert.ok(json, 'The page has no #channel-data');
	return JSON.parse(json);
};

/** @param {string} html */
const namesOf = (html) => rowsOf(html).map((row) => row.name);

/** The grid row for a channel. */
const rowFor = (html, name) => rowsOf(html).find((row) => row.name === name);

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
		assert.ok(namesOf(html).includes('test-channel'));
		assert.ok(!namesOf(html).includes('old-channel'));
		assert.ok(html.includes('Sign out'));
	});

	it('shows when each channel last had a message', async () => {
		const html = await (await get('/', cookie)).text();
		// #test-channel's message, from the fixture. Formatted in London time,
		// as the page does, so it matches whatever the runner's time zone.
		const lastMessage = new Date((nowSeconds - DAY_SECONDS) * 1000);

		assert.equal(
			rowFor(html, 'test-channel').lastMessage,
			lastMessage.toLocaleDateString('en-GB', {timeZone: 'Europe/London'}),
		);
	});

	it('marks channels with no messages in 30 days as inactive', async () => {
		const html = await (await get('/', cookie)).text();

		assert.equal(rowFor(html, 'quiet-channel').status, 'inactive');
		assert.equal(rowFor(html, 'test-channel').status, 'active');
	});

	it('shows archived channels', async () => {
		const res = await get('/?status=archived', cookie);
		const html = await res.text();

		assert.equal(res.status, 200);
		assert.deepEqual(namesOf(html), ['old-channel']);
		assert.ok(html.includes('data-status="archived"'));
	});
});

describe('the channels grid', () => {
	let cookie;

	before(async () => {
		({cookie} = await login('test@dxw.com'));
	});

	it('sends every channel on the tab, for the grid to sort and page through', async () => {
		const html = await (await get('/', cookie)).text();

		assert.equal(rowsOf(html).length, 32);
		assert.ok(html.includes('<div id="channel-grid" data-status="active"'));
		assert.ok(html.includes('/ag-grid-community@36.2.0/'));
	});
});

describe('searching', () => {
	let cookie;

	before(async () => {
		({cookie} = await login('test@dxw.com'));
	});

	it('shows only channels whose names match, ignoring case and a leading #', async () => {
		const html = await (await get('/?q=%23QUIET', cookie)).text();

		assert.deepEqual(namesOf(html), ['quiet-channel']);
		assert.ok(html.includes('1 channel found'));
		assert.ok(html.includes('value="#QUIET"'));
	});

	it('counts matching channels on each tab, and keeps the search when switching', async () => {
		const html = await (await get('/?q=channel', cookie)).text();

		// 32 active channels and 1 archived one have "channel" in their name.
		assert.ok(html.includes('href="/?status=archived&amp;q=channel"'));
		assert.match(html, /Archived\s*<span[^>]*>1<\/span>/);
	});

	it('says when nothing matches', async () => {
		const html = await (await get('/?q=nothing-like-this', cookie)).text();

		assert.ok(html.includes('No active channels match “nothing-like-this”.'));
		assert.deepEqual(rowsOf(html), []);
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

	before(async () => {
		({cookie} = await login('test@dxw.com'));
	});

	after(async () => {
		resetChannelData();
		await refreshChannels({token: 'xoxb-test', pauseMs: 0});
	});

	it('has the refresh banner and time on the page when not refreshing, for search.js to update', async () => {
		const html = await (await get('/', cookie)).text();

		assert.match(html, /<div id="refresh-banner">\s*<\/div>/);
		assert.match(html, /<p id="last-updated"[^>]*>Last updated /);
	});

	it('offers to archive inactive channels and ones with fewer than 2 members', async () => {
		const html = await (await get('/', cookie)).text();

		assert.equal(rowFor(html, 'quiet-channel').canArchive, true);
		assert.equal(rowFor(html, 'zz-channel-00').canArchive, true);
		assert.equal(rowFor(html, 'test-channel').canArchive, false);
	});

	it('gives the modal what it needs to ask to confirm', async () => {
		const html = await (await get('/', cookie)).text();

		assert.ok(html.includes('<dialog id="archive-dialog"'));
		assert.equal(
			rowFor(html, 'quiet-channel').archiveReason,
			'Nobody has posted in this channel in the last 30 days.',
		);
		assert.equal(
			rowFor(html, 'zz-channel-00').archiveReason,
			'This channel has fewer than 2 members.',
		);
	});

	it('refuses to archive an active channel', async () => {
		const res = await post('/channels/C123/archive', {cookie});

		assert.equal(res.status, 302);
		assert.equal(res.headers.get('location'), '/');
		assert.ok(!archivedIds.includes('C123'));

		const html = await (await get('/', cookie)).text();
		assert.ok(
			html.includes('That channel can’t be archived from the dashboard.'),
		);
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
		assert.ok(rowFor(archived, 'quiet-channel'));
	});

	it('shows the message only once', async () => {
		const html = await (await get('/', cookie)).text();

		assert.ok(!html.includes('#quiet-channel archived.'));
	});
});

describe('archiving several channels', () => {
	let cookie;

	before(async () => {
		({cookie} = await login('test@dxw.com'));
		resetChannelData();
		await refreshChannels({token: 'xoxb-test', pauseMs: 0});
	});

	after(async () => {
		resetChannelData();
		await refreshChannels({token: 'xoxb-test', pauseMs: 0});
	});

	it('has a form for the channels ticked in the grid', async () => {
		const html = await (await get('/', cookie)).text();

		assert.ok(html.includes('<form id="bulk-archive-form"'));
		assert.ok(html.includes('data-bulk-ids'));
	});

	it('archives the ones that qualify, and shows how it went once', async () => {
		const body = new URLSearchParams([
			['ids', 'C789'],
			['ids', 'C123'],
		]);
		const res = await post('/channels/archive', {body, cookie});
		assert.equal(res.status, 302);
		assert.equal(res.headers.get('location'), '/');
		await waitForBulkArchive();

		assert.equal(archivedIds.at(-1), 'C789');
		assert.ok(!archivedIds.includes('C123'));
		const html = await (await get('/', cookie)).text();
		assert.ok(html.includes('Archived 1 channel.'));
		assert.ok(html.includes('no longer qualify'));
		assert.ok(html.includes('#test-channel.'));

		const again = await (await get('/', cookie)).text();
		assert.ok(!again.includes('Archived 1 channel.'));
	});

	it('asks for at least one channel', async () => {
		await post('/channels/archive', {cookie});

		const html = await (await get('/', cookie)).text();
		assert.ok(html.includes('Select at least one channel to archive.'));
	});

	it('refuses more than 25 channels', async () => {
		const body = new URLSearchParams(
			Array.from({length: 26}, (_, i) => ['ids', `CZ${i}`]),
		);
		await post('/channels/archive', {body, cookie});

		const html = await (await get('/', cookie)).text();
		assert.ok(html.includes('You can archive at most 25 channels at a time.'));
	});
});
