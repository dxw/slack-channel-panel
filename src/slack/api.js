// A client for the Slack Web API methods used.

const SLACK_API_URL = 'https://slack.com/api/';

/**
 * @typedef {object} Channel
 * @property {string} id
 * @property {string} name
 * @property {boolean} isArchived
 * @property {boolean} isMember Whether the Slack bot is in the channel.
 * @property {number} memberCount Members, not counting the Slack bot.
 * @property {string} topic
 * @property {string} purpose
 * @property {Date} created
 */

/**
 * Picks the fields we use from a Slack conversation object.
 * @param {any} channel
 * @returns {Channel}
 */
export const toChannel = (channel) => {
	const isMember = channel.is_member ?? false;
	return {
		id: channel.id,
		name: channel.name,
		isArchived: channel.is_archived ?? false,
		isMember,
		memberCount: Math.max((channel.num_members ?? 0) - (isMember ? 1 : 0), 0),
		topic: channel.topic?.value ?? '',
		purpose: channel.purpose?.value ?? '',
		created: new Date(channel.created * 1000),
	};
};

/**
 * Calls a Slack Web API method, waiting and retrying if rate limited.
 * @param {string} method For example 'conversations.list'.
 * @param {Record<string, string>} params
 * @param {string} token Slack bot token.
 * @param {{post?: boolean}} [options] POST the params as a form (for writes).
 * @returns {Promise<any>} The response body.
 */
export const callSlack = async (method, params, token, {post = false} = {}) => {
	const url = new URL(method, SLACK_API_URL);
	const body = new URLSearchParams(params);
	if (!post) {
		url.search = body.toString();
	}

	const res = await fetch(url, {
		method: post ? 'POST' : 'GET',
		headers: {Authorization: `Bearer ${token}`},
		...(post && {body}),
	});

	if (res.status === 429) {
		const retryAfterSeconds = Number(res.headers.get('retry-after') ?? 1);
		await new Promise((resolve) =>
			setTimeout(resolve, retryAfterSeconds * 1000),
		);
		return callSlack(method, params, token, {post});
	}

	if (!res.ok) {
		throw new Error(`Slack ${method} failed: HTTP ${res.status}`);
	}

	const json = await res.json();
	if (!json.ok) {
		throw new Error(`Slack ${method} failed: ${json.error}`);
	}
	return json;
};

/**
 * Lists every public channel in the workspace, following pagination.
 * Needs channels:read.
 * @param {string} token
 * @returns {Promise<Channel[]>}
 */
export const listChannels = async (token) => {
	const channels = [];
	let cursor = '';

	do {
		const body = await callSlack(
			'conversations.list',
			{
				types: 'public_channel',
				exclude_archived: 'false',
				limit: '1000',
				...(cursor && {cursor}),
			},
			token,
		);
		channels.push(...body.channels.map(toChannel));
		cursor = body.response_metadata?.next_cursor ?? '';
	} while (cursor);

	return channels;
};

/**
 * Adds our bot to a public channel, so it can read the messages.
 * Needs channels:join.
 * @param {string} token
 * @param {string} channelId
 */
export const joinChannel = async (token, channelId) => {
	await callSlack('conversations.join', {channel: channelId}, token, {
		post: true,
	});
};

/**
 * Fetches a channel's 100 most recent top-level messages, newest first.
 * Needs channels:history, and the bot must be in the channel.
 * @param {string} token
 * @param {string} channelId
 * @returns {Promise<any[]>}
 */
export const fetchRecentMessages = async (token, channelId) => {
	const body = await callSlack(
		'conversations.history',
		{channel: channelId, limit: '100'},
		token,
	);
	return body.messages;
};
