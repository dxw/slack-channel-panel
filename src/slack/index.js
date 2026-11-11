import {fakeChannels} from './fake-channels.js';

const CONVERSATIONS_LIST_URL = 'https://slack.com/api/conversations.list';
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_RETRIES = 3; // number of retries after being rate limited by Slack

/**
 * @typedef {object} Channel
 * @property {string} id
 * @property {string} name
 * @property {boolean} isArchived
 * @property {number} memberCount
 * @property {string} topic
 * @property {string} purpose
 * @property {Date} created
 */

/**
 * Picks the fields we use from a Slack conversation object.
 * @param {any} channel
 * @returns {Channel}
 */
export const toChannel = (channel) => ({
	id: channel.id,
	name: channel.name,
	isArchived: channel.is_archived,
	memberCount: channel.num_members ?? 0,
	topic: channel.topic?.value ?? '',
	purpose: channel.purpose?.value ?? '',
	created: new Date(channel.created * 1000),
});

/**
 * Fetches one page of conversations.list, retrying if rate limited.
 * Gives up after MAX_RETRIES retries, so callers aren't left waiting forever.
 * @param {string} token
 * @param {string} cursor
 * @param {number} [retries] How many times this page has been retried.
 */
const fetchPage = async (token, cursor, retries = 0) => {
	const url = new URL(CONVERSATIONS_LIST_URL);
	url.search = new URLSearchParams({
		types: 'public_channel',
		exclude_archived: 'false',
		limit: '1000',
		...(cursor && {cursor}),
	}).toString();

	const res = await fetch(url, {
		headers: {Authorization: `Bearer ${token}`},
	});

	if (res.status === 429) {
		if (retries >= MAX_RETRIES) {
			throw new Error(
				`Slack conversations.list failed: still rate limited after ${MAX_RETRIES} retries`,
			);
		}
		const retryAfterSeconds = Number(res.headers.get('retry-after') ?? 1);
		await new Promise((resolve) =>
			setTimeout(resolve, retryAfterSeconds * 1000),
		);
		return fetchPage(token, cursor, retries + 1);
	}

	if (!res.ok) {
		throw new Error(`Slack conversations.list failed: HTTP ${res.status}`);
	}

	const body = await res.json();
	if (!body.ok) {
		throw new Error(`Slack conversations.list failed: ${body.error}`);
	}
	return body;
};

/**
 * Fetches every public channel in the workspace, following pagination.
 * @param {string} token Slack bot token with channels:read.
 * @returns {Promise<Channel[]>}
 */
export const fetchChannels = async (token) => {
	const channels = [];
	let cursor = '';

	do {
		const body = await fetchPage(token, cursor);
		channels.push(...body.channels.map(toChannel));
		cursor = body.response_metadata?.next_cursor ?? '';
	} while (cursor);

	return channels;
};

/** @type {{channels: Channel[], fetchedAt: number} | undefined} */
let cache;
/** @type {Promise<{channels: Channel[], fetchedAt: number}> | undefined} */
let inFlight;

/** Empties the channel cache. Used by tests. */
export const clearChannelCache = () => {
	cache = undefined;
	inFlight = undefined;
};

/**
 * Returns the workspace's channels, cached in memory for 15 minutes.
 * @param {number} [now] Current time in ms, for tests.
 * @returns {Promise<{channels: Channel[], fetchedAt: number}>}
 */
export const getChannels = async (now = Date.now()) => {
	if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
		return cache;
	}

	if (
		process.env.SLACK_FAKE_DATA === 'true' &&
		process.env.NODE_ENV !== 'production'
	) {
		cache = {channels: fakeChannels.map(toChannel), fetchedAt: now};
		return cache;
	}

	const token = process.env.SLACK_BOT_TOKEN;
	if (!token) {
		throw new Error(
			'SLACK_BOT_TOKEN is not set. Set SLACK_FAKE_DATA=true to use made-up channels in development.',
		);
	}

	inFlight ??= fetchChannels(token)
		.then((channels) => {
			console.log(`Fetched ${channels.length} channels from Slack`);
			cache = {channels, fetchedAt: now};
			return cache;
		})
		.finally(() => {
			inFlight = undefined;
		});

	return inFlight;
};
