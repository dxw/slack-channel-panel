// A client for the Slack Web API methods used.

const SLACK_API_URL = 'https://slack.com/api/';
const MAX_RETRIES = 3; // number of retries after being rate limited by Slack

/**
 * @typedef {object} Channel
 * @property {string} id
 * @property {string} name
 * @property {boolean} isArchived
 * @property {boolean} isGeneral Whether it's the workspace's #general channel,
 *   which Slack never lets anyone archive.
 * @property {boolean} isMember Whether the Slack bot is in the channel.
 * @property {boolean} isExternal Whether it's a Slack Connect channel, shared
 *   (or being shared) with another organisation.
 * @property {string | null} hostTeamId The ID of the Slack team (organisation)
 *   that owns the channel. For Slack Connect channels this may be another
 *   organisation's.
 * @property {number} memberCount Members, not counting the Slack bot.
 * @property {string} topic
 * @property {string} purpose
 * @property {Date} created
 * @property {Date | null} archivedAt When an archived channel was archived,
 *   taken from Slack's `updated` field. Null if not archived.
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
		isGeneral: channel.is_general ?? false,
		isMember,
		isExternal: Boolean(channel.is_ext_shared || channel.is_pending_ext_shared),
		hostTeamId: channel.conversation_host_id ?? null,
		memberCount: Math.max((channel.num_members ?? 0) - (isMember ? 1 : 0), 0),
		topic: channel.topic?.value ?? '',
		purpose: channel.purpose?.value ?? '',
		created: new Date(channel.created * 1000),
		// Slack has no "archived at" field. `updated` is when the channel's
		// settings last changed (in ms, unlike `created`), and archiving is the
		// last change an archived channel can have, so we use that.
		archivedAt:
			channel.is_archived && channel.updated ? new Date(channel.updated) : null,
	};
};

/**
 * Calls a Slack Web API method, waiting and retrying if rate limited.
 * Gives up after MAX_RETRIES retries, so callers aren't left waiting forever.
 * @param {string} method For example 'conversations.list'.
 * @param {Record<string, string>} params
 * @param {string} token Slack bot token.
 * @param {{post?: boolean, retries?: number}} [options] `post` sends the
 *   params as a form (for writes). `retries` is how many times this call has
 *   been retried.
 * @returns {Promise<any>} The response body.
 */
export const callSlack = async (
	method,
	params,
	token,
	{post = false, retries = 0} = {},
) => {
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
		if (retries >= MAX_RETRIES) {
			throw new Error(
				`Slack ${method} failed: still rate limited after ${MAX_RETRIES} retries`,
			);
		}
		const retryAfterSeconds = Number(res.headers.get('retry-after') ?? 1);
		await new Promise((resolve) =>
			setTimeout(resolve, retryAfterSeconds * 1000),
		);
		return callSlack(method, params, token, {post, retries: retries + 1});
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
 * Returns the ID of the Slack team (organisation) the bot is installed in.
 * Needs no extra scopes.
 * @param {string} token
 * @returns {Promise<string>}
 */
export const getOwnTeamId = async (token) => {
	const body = await callSlack('auth.test', {}, token);
	return body.team_id;
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
 * Fetches one channel's current details, including its member count.
 * Needs channels:read.
 * @param {string} token
 * @param {string} channelId
 * @returns {Promise<Channel>}
 */
export const getChannelInfo = async (token, channelId) => {
	const body = await callSlack(
		'conversations.info',
		{channel: channelId, include_num_members: 'true'},
		token,
	);
	return toChannel(body.channel);
};

/**
 * Archives a public channel.
 * Needs channels:manage, and the bot must be in the channel.
 * @param {string} token
 * @param {string} channelId
 */
export const archiveChannel = async (token, channelId) => {
	await callSlack('conversations.archive', {channel: channelId}, token, {
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
