// Works out channel activity from Slack messages. Messages from people and
// from bots both count; Slack's own messages (joins, topic changes…) don't.
const DAY_MS = 24 * 60 * 60 * 1000;
// Messages are counted over the last 30 days, and a channel is inactive
// after 30 days with no messages.
export const MONTH_MS = 30 * DAY_MS;

// Message subtypes that count as activity. Plain messages, from people or
// bots, have no subtype.
const COUNTED_SUBTYPES = new Set([
	'bot_message',
	'thread_broadcast',
	'file_share',
	'me_message',
]);

/**
 * @typedef {object} Activity
 * @property {Date | null} lastMessageAt Newest message or thread reply, from a
 *   person or a bot.
 * @property {number} messagesLastMonth Top-level messages from people and bots
 *   in the last 30 days. At most 100, as only the newest 100 messages are fetched.
 */

/**
 * Whether a message counts as activity: posted by a person or a bot, not an
 * automatic message from Slack such as someone joining.
 * @param {any} message
 */
export const isCountedMessage = (message) =>
	message.subtype === undefined || COUNTED_SUBTYPES.has(message.subtype);

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
	const counted = messages.filter(isCountedMessage);

	// Thread replies don't appear in the history, but their parent message
	// has the time of the latest reply.
	const latestMs = Math.max(
		...counted.flatMap((message) => [
			tsToMs(message.ts),
			message.latest_reply ? tsToMs(message.latest_reply) : 0,
		]),
	);

	return {
		lastMessageAt: counted.length ? new Date(latestMs) : null,
		messagesLastMonth: counted.filter(
			(message) => now - tsToMs(message.ts) < MONTH_MS,
		).length,
	};
};

/**
 * Whether a channel has had no messages, from people or bots, in the last 30 days.
 * False if we don't know the channel's activity yet.
 * @param {Activity | undefined} activity
 * @param {number} [now] Current time in ms.
 */
export const isInactive = (activity, now = Date.now()) =>
	activity !== undefined &&
	(activity.lastMessageAt === null ||
		now - activity.lastMessageAt.getTime() >= MONTH_MS);
