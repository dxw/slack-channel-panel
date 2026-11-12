// Keeps the workspace's channels and their activity in memory, refreshed from Slack in the background.
// Page views read from here and never call Slack themselves.

import {
	listChannels,
	getOwnTeamId,
	joinChannel,
	fetchRecentMessages,
	toChannel,
} from './api.js';
import {summariseActivity, isInactive} from './activity.js';
import {fakeChannels, fakeMessages} from './fake-channels.js';

const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
// conversations.history allows about 50 calls a minute, so pause between channels.
const PAUSE_BETWEEN_CHANNELS_MS = 1200;

/** @typedef {import('./api.js').Channel} Channel */
/** @typedef {import('./activity.js').Activity} Activity */

const emptyState = () => ({
	/** @type {Channel[]} */
	channels: [],
	/** @type {Map<string, Activity>} */
	activity: new Map(),
	/** @type {Date | null} */
	refreshedAt: null,
	refreshing: false,
	progress: {done: 0, total: 0},
	/** @type {string | null} */
	error: null,
});

let state = emptyState();

/** Empties the store. Used by tests. */
export const resetChannelData = () => {
	state = emptyState();
};

/**
 * @param {number} ms
 */
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetches all channels, then each active channel's recent messages. Results
 * are stored as they arrive, so the page fills in during the first refresh.
 *
 * The bot can only read channels it's a member of. Joining posts a "joined"
 * message in the channel, so it's off unless SLACK_JOIN_CHANNELS=true; until
 * then, only channels the bot is already in are checked.
 * @param {object} options
 * @param {string} options.token Slack bot token.
 * @param {boolean} [options.joinChannels] Join channels the bot isn't in yet.
 * @param {number} [options.pauseMs] Pause between channels, to respect rate limits.
 * @param {() => number} [options.now] Current time in ms, for tests.
 */
export const refreshChannels = async ({
	token,
	joinChannels = process.env.SLACK_JOIN_CHANNELS === 'true',
	pauseMs = PAUSE_BETWEEN_CHANNELS_MS,
	now = Date.now,
}) => {
	if (state.refreshing) {
		return;
	}
	state.refreshing = true;

	try {
		const channels = await listChannels(token);
		state.channels = channels;
		state.error = null;

		// Only check channels the bot is in, or can join. It joins Slack Connect
		// channels only if they're hosted by our own organisation, never ones
		// another organisation owns and has shared with us.
		const ownTeamId = joinChannels ? await getOwnTeamId(token) : null;
		const canJoin = (channel) =>
			joinChannels &&
			(!channel.isExternal || channel.hostTeamId === ownTeamId);
		const toCheck = channels.filter(
			(channel) =>
				!channel.isArchived && (channel.isMember || canJoin(channel)),
		);
		state.progress = {done: 0, total: toCheck.length};
		console.log(
			`Checking activity in ${toCheck.length} channels` +
				(joinChannels ? '' : ' (only ones the bot is already in)'),
		);

		for (const channel of toCheck) {
			try {
				if (!channel.isMember) {
					await joinChannel(token, channel.id);
					console.log(`Joined #${channel.name}`);
				}
				const messages = await fetchRecentMessages(token, channel.id);
				state.activity.set(channel.id, summariseActivity(messages, now()));
			} catch (error) {
				// Keep going: one channel failing shouldn't stop the rest.
				state.activity.delete(channel.id);
				console.error(`Couldn’t check #${channel.name}: ${error.message}`);
			}
			state.progress.done += 1;
			await pause(pauseMs);
		}

		state.refreshedAt = new Date(now());
		console.log('Finished checking channel activity');
	} catch (error) {
		// Keep any channels from the last refresh.
		state.error = error.message;
		console.error(`Couldn’t refresh channels: ${error.message}`);
	} finally {
		state.refreshing = false;
	}
};

/** Fills the store with made-up channels, without calling Slack. */
const loadFakeChannels = () => {
	state.channels = fakeChannels.map(toChannel);
	// Like a real refresh, archived channels aren't checked.
	for (const channel of state.channels.filter((c) => !c.isArchived)) {
		state.activity.set(
			channel.id,
			summariseActivity(fakeMessages[channel.id] ?? []),
		);
	}
	state.refreshedAt = new Date();
	state.error = null;
};

/**
 * Starts refreshing channels now and every 6 hours.
 * Uses made-up channels if SLACK_FAKE_DATA=true (not in production).
 */
export const startChannelRefresh = () => {
	if (
		process.env.SLACK_FAKE_DATA === 'true' &&
		process.env.NODE_ENV !== 'production'
	) {
		console.warn('Using fake Slack data');
		loadFakeChannels();
		return;
	}

	const token = process.env.SLACK_BOT_TOKEN;
	if (!token) {
		state.error = 'SLACK_BOT_TOKEN is not set';
		console.error(
			'SLACK_BOT_TOKEN is not set. Set SLACK_FAKE_DATA=true to use made-up channels in development.',
		);
		return;
	}

	refreshChannels({token});
	setInterval(() => refreshChannels({token}), REFRESH_INTERVAL_MS);
};

/**
 * Returns the stored channels, each with its activity.
 * @param {number} [now] Current time in ms.
 */
export const getChannelData = (now = Date.now()) => ({
	channels: state.channels.map((channel) => {
		const activity = state.activity.get(channel.id);
		return {
			...channel,
			activity,
			inactive: !channel.isArchived && isInactive(activity, now),
		};
	}),
	refreshedAt: state.refreshedAt,
	refreshing: state.refreshing,
	progress: {...state.progress},
	error: state.error,
});
