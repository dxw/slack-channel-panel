// Works out channel activity from Slack messages
const DAY_MS = 24 * 60 * 60 * 1000;
// A channel is inactive after a week with no messages from people.
export const WEEK_MS = 7 * DAY_MS;
// Messages are counted over the last 30 days.
export const MONTH_MS = 30 * DAY_MS;

// Filter for message subtypes that are classed as acitivty
const HUMAN_SUBTYPES = new Set([
	'thread_broadcast',
	'file_share',
	'me_message',
]);

/**
 * @typedef {object} Activity
 * @property {Date | null} lastMessageAt Newest message or thread reply from a person.
 * @property {number} messagesLastMonth Top-level messages from people in the last
 *   30 days. At most 100, as only the newest 100 messages are fetched.
 */

/**
 * Whether a message was posted by a person, not a bot or Slack itself.
 * @param {any} message
 */
export const isHumanMessage = (message) =>
	!message.bot_id &&
	(message.subtype === undefined || HUMAN_SUBTYPES.has(message.subtype));

/**
 * Converts a Slack timestamp ("1731230400.123456", in seconds) to ms.
 * @param {string} ts
 */
const tsToMs = (ts) => Number(ts) * 1000;

/**
 * Summarises activity from a channel's recent messages.
 * @param {any[]} messages From conversations.history.
 * @param {number} [now] Current time in ms.
 * @returns {Activity}
 */
export const summariseActivity = (messages, now = Date.now()) => {
	const human = messages.filter(isHumanMessage);

	// Thread replies don't appear in the history, but their parent message
	// has the time of the latest reply.
	const latestMs = Math.max(
		...human.flatMap((message) => [
			tsToMs(message.ts),
			message.latest_reply ? tsToMs(message.latest_reply) : 0,
		]),
	);

	return {
		lastMessageAt: human.length ? new Date(latestMs) : null,
		messagesLastMonth: human.filter(
			(message) => now - tsToMs(message.ts) < MONTH_MS,
		).length,
	};
};

/**
 * Whether a channel has had no messages from people in the last 7 days.
 * False if we don't know the channel's activity yet.
 * @param {Activity | undefined} activity
 * @param {number} [now] Current time in ms.
 */
export const isInactive = (activity, now = Date.now()) =>
	activity !== undefined &&
	(activity.lastMessageAt === null ||
		now - activity.lastMessageAt.getTime() >= WEEK_MS);
