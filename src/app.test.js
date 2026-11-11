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
const realFetch = globalThis.fetch;
mock.method(globalThis, 'fetch', async (url, options) =>
	String(url).startsWith('https://slack.com/')
		? Response.json(
				slackFails
					? {ok: false, error: 'invalid_auth'}
					: {
							ok: true,
							channels: [
								{
									id: 'C123',
									name: 'test-channel',
									is_archived: false,
									num_members: 3,
									topic: {value: ''},
									purpose: {value: 'A channel for tests'},
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
								// 30 more active channels, sorted after #test-channel, so
								// there are 31 active channels across 2 pages.
								...Array.from({length: 30}, (_, i) => ({
									id: `CZ${i}`,
									name: `zz-channel-${String(i).padStart(2, '0')}`,
									is_archived: false,
									num_members: 1,
									topic: {value: ''},
									purpose: {value: ''},
									created: 1_600_000_000,
								})),
							],
							response_metadata: {next_cursor: ''},
						},
			)
		: realFetch(url, options),
);

const {default: app} = await import('./app.js');
const {clearChannelCache} = await import('./slack/index.js');

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

	it('shows archived channels', async () => {
		const res = await get('/?status=archived', cookie);
		const html = await res.text();

		assert.equal(res.status, 200);
		assert.ok(html.includes('#old-channel'));
		assert.ok(!html.includes('#test-channel'));
	});

	it('shows 25 channels per page', async () => {
		const html = await (await get('/', cookie)).text();

		assert.ok(html.includes('Showing 1–25 of 31 channels'));
		assert.ok(html.includes('#zz-channel-23'));
		assert.ok(!html.includes('#zz-channel-24'));
		assert.ok(html.includes('href="/?page=2"'));
	});

	it('shows the next page', async () => {
		const html = await (await get('/?page=2', cookie)).text();

		assert.ok(html.includes('Showing 26–31 of 31 channels'));
		assert.ok(html.includes('#zz-channel-29'));
		assert.ok(!html.includes('#test-channel'));
		assert.ok(html.includes('href="/"'));
	});
});

describe('when Slack fails', () => {
	let cookie;

	before(async () => {
		({cookie} = await login('test@dxw.com'));
		slackFails = true;
		clearChannelCache();
	});

	after(() => {
		slackFails = false;
		clearChannelCache();
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
