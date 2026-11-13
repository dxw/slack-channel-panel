// Keeps the workspace's channels and their activity in memory, refreshed from Slack in the background.
// Page views read from here and never call Slack themselves.

import {
	listChannels,
	getOwnTeamId,
	joinChannel,
	archiveChannel,
	getChannelInfo,
	fetchRecentMessages,
	getTeamName,
	toChannel,
} from './api.js';
import {summariseActivity, isInactive} from './activity.js';
import {
	fakeChannels,
	fakeMessages,
	fakeTeamNames,
	FAKE_TEAM_ID,
} from './fake-channels.js';
import {CACHE_FILE, saveCache, loadCache} from './cache.js';

const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
// conversations.history allows about 50 calls a minute, so pause between channels.
const PAUSE_BETWEEN_CHANNELS_MS = 1200;
// Channels younger than this aren't offered for archiving, as they may not
// have been used yet.
const NEW_CHANNEL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

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
	/** The ID of our own Slack team (organisation). @type {string | null} */
	ownTeamId: null,
	/** Names of other organisations in Slack Connect channels, by team ID. @type {Map<string, string>} */
	teamNames: new Map(),
	/** Whether the channels are made up, so archiving shouldn't call Slack. */
	fake: false,
});

let state = emptyState();

/** Where to save the data between restarts, in development. Null to not save it. @type {string | null} */
let cacheFile = null;

/** Saves the data to cacheFile, if set. */
const saveToCache = () => {
	if (!cacheFile) {
		return;
	}
	try {
		saveCache(cacheFile, {
			channels: state.channels,
			activity: state.activity,
			teamNames: state.teamNames,
			ownTeamId: state.ownTeamId,
			refreshedAt: state.refreshedAt,
		});
	} catch (error) {
		console.error(
			`Couldn’t save channel data to ${cacheFile}: ${error.message}`,
		);
	}
};

/** Empties the store. Used by tests. */
export const resetChannelData = () => {
	state = emptyState();
	cacheFile = null;
};

/**
 * @param {number} ms
 */
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Whether a channel belongs to our organisation: not Slack Connect, or a Slack
 * Connect channel we host.
 * @param {Channel} channel
 * @param {string | null} ownTeamId
 */
const isOurs = (channel, ownTeamId) =>
	!channel.isExternal ||
	(ownTeamId !== null && channel.hostTeamId === ownTeamId);

/**
 * Whether the dashboard offers to archive a channel: it's quiet (inactive, or
 * fewer than 2 members), at least a week old, the bot is in it (so we know its
 * activity, and Slack lets the bot archive it), and it's ours to archive.
 * @param {Channel & {inactive: boolean}} channel
 * @param {string | null} ownTeamId
 * @param {number} [now] Current time in ms.
 */
export const isArchivable = (channel, ownTeamId, now = Date.now()) =>
	!channel.isArchived &&
	!channel.isGeneral &&
	now - channel.created.getTime() >= NEW_CHANNEL_MS &&
	channel.isMember &&
	isOurs(channel, ownTeamId) &&
	(channel.inactive || channel.memberCount < 2);

/**
 * The IDs of the other organisations in a Slack Connect channel.
 * @param {Channel} channel
 * @param {string | null} ownTeamId
 */
const externalTeamIds = (channel, ownTeamId) =>
	channel.sharedTeamIds.filter((id) => id !== ownTeamId);

/**
 * Fills in which organisations are in each Slack Connect channel.
 * conversations.list leaves this out, so each channel's details are fetched.
 * Archived channels are skipped, as the dashboard doesn't show this for them.
 * @param {string} token
 * @param {Channel[]} channels Updated in place.
 * @param {number} pauseMs Pause between channels, to respect rate limits.
 */
const fetchSharedTeamIds = async (token, channels, pauseMs) => {
	for (const channel of channels) {
		if (!channel.isExternal || channel.isArchived) {
			continue;
		}
		try {
			channel.sharedTeamIds = (
				await getChannelInfo(token, channel.id)
			).sharedTeamIds;
		} catch (error) {
			// Keep going: the channel just won't show who it's shared with.
			console.error(
				`Couldn’t get who #${channel.name} is shared with: ${error.message}`,
			);
		}
		await pause(pauseMs);
	}
};

/**
 * Looks up the names of other organisations in Slack Connect channels that we
 * don't know yet. Organisations rarely rename, so names are kept between
 * refreshes. If a lookup fails, the organisation's name is left out.
 * @param {string} token
 * @param {Channel[]} channels
 * @param {string | null} ownTeamId
 */
const fetchTeamNames = async (token, channels, ownTeamId) => {
	const unknown = new Set(
		channels
			.flatMap((channel) => externalTeamIds(channel, ownTeamId))
			.filter((id) => !state.teamNames.has(id)),
	);
	for (const id of unknown) {
		try {
			state.teamNames.set(id, await getTeamName(token, id));
		} catch (error) {
			console.error(`Couldn’t get the name of team ${id}: ${error.message}`);
		}
	}
};

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
		// Needed to tell which Slack Connect channels are ours to join or archive.
		const ownTeamId = await getOwnTeamId(token);
		state.ownTeamId = ownTeamId ?? null;
		await fetchSharedTeamIds(token, channels, pauseMs);
		await fetchTeamNames(token, channels, state.ownTeamId);

		// Only check channels the bot is in, or can join. It joins Slack Connect
		// channels only if they're hosted by our own organisation, never ones
		// another organisation owns and has shared with us.
		const canJoin = (channel) => joinChannels && isOurs(channel, ownTeamId);
		const toCheck = channels.filter(
			(channel) =>
				!channel.isArchived && (channel.isMember || canJoin(channel)),
		);
		const checkedIds = new Set(toCheck.map((channel) => channel.id));
		for (const id of state.activity.keys()) {
			if (!checkedIds.has(id)) {
				state.activity.delete(id);
			}
		}
		state.progress = {done: 0, total: toCheck.length};
		console.log(
			`Checking activity in ${toCheck.length} channels` +
				(joinChannels ? '' : ' (only ones the bot is already in)'),
		);

		for (const channel of toCheck) {
			try {
				if (!channel.isMember) {
					await joinChannel(token, channel.id);
					channel.isMember = true;
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
		saveToCache();
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
	state.ownTeamId = FAKE_TEAM_ID;
	state.teamNames = new Map(Object.entries(fakeTeamNames));
	state.fake = true;
};

/**
 * Starts refreshing channels now and every 6 hours.
 * Uses made-up channels if SLACK_FAKE_DATA=true (not in production).
 *
 * In development, the data is saved to a file after each refresh. On start,
 * if that data is less than 6 hours old, it's used instead of refreshing now,
 * and the next refresh is when it's 6 hours old.
 * @param {object} [options]
 * @param {string} [options.cache] Where to save the data in development.
 */
export const startChannelRefresh = ({cache = CACHE_FILE} = {}) => {
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

	const startRefreshing = () => {
		refreshChannels({token});
		setInterval(() => refreshChannels({token}), REFRESH_INTERVAL_MS);
	};

	if (process.env.NODE_ENV !== 'production') {
		cacheFile = cache;
		const cached = loadCache(cache);
		const age = cached ? Date.now() - cached.refreshedAt.getTime() : Infinity;
		if (cached && age < REFRESH_INTERVAL_MS) {
			Object.assign(state, cached);
			console.log(
				`Using channel data saved at ${cached.refreshedAt.toLocaleString('en-GB')}. Delete ${cache} to refresh from Slack now.`,
			);
			setTimeout(startRefreshing, REFRESH_INTERVAL_MS - age);
			return;
		}
	}

	startRefreshing();
};

/**
 * A link that opens a channel in the Slack app if it's installed, otherwise
 * in the browser. The team ID makes sure it opens in our workspace.
 * @param {string} channelId
 * @param {string | null} teamId
 */
export const slackChannelUrl = (channelId, teamId) => {
	const url = new URL('https://slack.com/app_redirect');
	url.searchParams.set('channel', channelId);
	if (teamId) {
		url.searchParams.set('team', teamId);
	}
	return url.toString();
};

/**
 * A stored channel with its activity, whether it's inactive or archivable,
 * the names of other organisations in it, and a link to it in Slack.
 * @param {Channel} channel
 * @param {number} now Current time in ms.
 */
const withActivity = (channel, now) => {
	const activity = state.activity.get(channel.id);
	const withInactive = {
		...channel,
		activity,
		inactive: !channel.isArchived && isInactive(activity, now),
	};
	return {
		...withInactive,
		canArchive: isArchivable(withInactive, state.ownTeamId, now),
		externalTeams: externalTeamIds(channel, state.ownTeamId)
			.map((id) => state.teamNames.get(id))
			.filter(Boolean),
		slackUrl: slackChannelUrl(channel.id, state.ownTeamId),
	};
};

/**
 * Returns the stored channels, each with its activity.
 * @param {number} [now] Current time in ms.
 */
export const getChannelData = (now = Date.now()) => ({
	channels: state.channels.map((channel) => withActivity(channel, now)),
	refreshedAt: state.refreshedAt,
	refreshing: state.refreshing,
	progress: {...state.progress},
	error: state.error,
});

/**
 * Returns one stored channel with its activity, or undefined if there's none
 * with that ID.
 * @param {string} id
 * @param {number} [now] Current time in ms.
 */
export const getChannel = (id, now = Date.now()) => {
	const channel = state.channels.find((c) => c.id === id);
	return channel && withActivity(channel, now);
};

/**
 * Thrown when a channel shouldn't be archived from the dashboard, e.g.
 * because it has had new messages or members since the last refresh.
 */
export class NotArchivableError extends Error {
	constructor() {
		super('This channel can’t be archived from the dashboard');
		this.name = 'NotArchivableError';
	}
}

/**
 * Checks with Slack that a channel can still be archived, as the stored data
 * can be hours old. Updates the stored channel and its activity with what
 * Slack returns. Throws if Slack can't be checked.
 * @param {string} token
 * @param {string} id
 * @param {number} now Current time in ms.
 * @returns {Promise<boolean>}
 */
const checkStillArchivable = async (token, id, now) => {
	const [fresh, messages, ownTeamId] = await Promise.all([
		getChannelInfo(token, id),
		fetchRecentMessages(token, id),
		getOwnTeamId(token),
	]);
	const activity = summariseActivity(messages, now);

	const index = state.channels.findIndex((c) => c.id === id);
	if (index !== -1) {
		state.channels[index] = fresh;
	}
	state.activity.set(id, activity);
	state.ownTeamId = ownTeamId ?? null;

	return isArchivable(
		{
			...fresh,
			inactive: !fresh.isArchived && isInactive(activity, now),
		},
		state.ownTeamId,
		now,
	);
};

/**
 * Archives a channel in Slack, then marks it archived here, so it moves to
 * the Archived tab without waiting for the next refresh.
 *
 * Refuses (with NotArchivableError) channels the dashboard doesn't offer to
 * archive. Before archiving, checks the channel's current members and
 * messages with Slack, and refuses if it no longer qualifies or if that check
 * fails. With made-up channels, Slack isn't called.
 * @param {object} options
 * @param {string} options.id The channel's ID.
 * @param {string | undefined} options.token Slack bot token.
 * @param {number} [options.now] Current time in ms.
 * @returns {Promise<Channel>} The archived channel.
 */
export const archiveChannelById = async ({id, token, now = Date.now()}) => {
	const channel = getChannel(id, now);
	if (!channel?.canArchive) {
		throw new NotArchivableError();
	}
	if (!state.fake) {
		if (!token) {
			throw new Error('SLACK_BOT_TOKEN is not set');
		}
		if (!(await checkStillArchivable(token, id, now))) {
			throw new NotArchivableError();
		}
		await archiveChannel(token, id);
	}

	const stored = state.channels.find((c) => c.id === id);
	stored.isArchived = true;
	stored.archivedAt = new Date(now);
	state.activity.delete(id);
	console.log(`Archived #${stored.name}`);
	saveToCache();
	return stored;
};
