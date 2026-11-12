// Made-up channels and messages in the shapes Slack's conversations.list and
// conversations.history return them. Used when SLACK_FAKE_DATA=true, so the
// app can run without a Slack token.

const DAY_SECONDS = 24 * 60 * 60;
const NOW_SECONDS = Math.floor(Date.now() / 1000);

const names = [
	'general',
	'random',
	'announcements',
	'dev',
	'design',
	'support',
	'ops-alerts',
	'project-apollo',
	'project-borealis',
	'project-cobalt',
	'social',
	'pets',
	'book-club',
	'running',
	'help-it',
	'old-website',
	'hackday-2019',
	'recruitment',
	'learning',
	'music',
];

/** The made-up ID of our own Slack team (organisation). */
export const FAKE_TEAM_ID = 'TFAKE';

export const fakeChannels = names.map((name, i) => ({
	id: `CFAKE${String(i).padStart(4, '0')}`,
	name,
	is_archived: name === 'old-website' || name === 'hackday-2019',
	is_general: name === 'general',
	is_member: true,
	// Slack Connect channels: #project-borealis is hosted by another
	// organisation, and #design is hosted by us.
	is_ext_shared: name === 'project-borealis' || name === 'design',
	conversation_host_id: name === 'project-borealis' ? 'TOTHER' : FAKE_TEAM_ID,
	// #pets is small but busy, and #project-borealis small but not ours, so
	// neither can be archived; #general can never be archived.
	num_members:
		name === 'pets'
			? 2
			: name === 'project-borealis'
				? 2
				: ((i * 37) % 120) + 1,
	topic: {value: ''},
	purpose: {value: `A made-up channel for ${name.replaceAll('-', ' ')}`},
	created: NOW_SECONDS - (i + 1) * 90 * DAY_SECONDS,
	// When the channel's settings last changed, in ms. For archived channels,
	// this is when they were archived.
	updated: (NOW_SECONDS - (i + 1) * 20 * DAY_SECONDS) * 1000,
}));

/**
 * A Slack timestamp for a number of days ago.
 * @param {number} days
 */
const daysAgo = (days) => `${NOW_SECONDS - days * DAY_SECONDS}.000100`;

/** @type {(days: number) => object} */
const personPost = (days) => ({
	type: 'message',
	user: 'UFAKE',
	ts: daysAgo(days),
});
/** @type {(days: number) => object} */
const botPost = (days) => ({
	type: 'message',
	subtype: 'bot_message',
	bot_id: 'BFAKE',
	ts: daysAgo(days),
});
/** @type {(days: number) => object} */
const joined = (days) => ({
	type: 'message',
	subtype: 'channel_join',
	user: 'UFAKE',
	ts: daysAgo(days),
});

/**
 * Builds a channel's messages, newest first.
 * @param {number} recentPosts Posts by people spread over the last few days.
 * @param {number} lastPostDaysAgo When the newest post was, in days.
 */
const posts = (recentPosts, lastPostDaysAgo) =>
	Array.from({length: recentPosts}, (_, i) =>
		personPost(lastPostDaysAgo + i * 0.5),
	);

/**
 * Made-up recent messages for each channel, keyed by channel ID.
 * Some are busy, some quiet, and some inactive (no messages in 30 days).
 * @type {Record<string, object[]>}
 */
export const fakeMessages = Object.fromEntries(
	fakeChannels.map((channel, i) => {
		const messages =
			{
				// Active only because a bot posts in it.
				'ops-alerts': [botPost(0.1), botPost(1), joined(2), personPost(40)],
				// Inactive: last message a month ago.
				'book-club': [joined(1), personPost(30)],
				// Inactive: never used.
				running: [joined(1)],
				// Active only because of a recent thread reply.
				'project-cobalt': [
					{...personPost(20), reply_count: 3, latest_reply: daysAgo(2)},
				],
			}[channel.name] ?? posts((i % 6) * 4 + 1, i % 3);
		return [channel.id, messages];
	}),
);
