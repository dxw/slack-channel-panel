// Works out channel activity from Slack messages. Only messages from people
// count: not bots or apps, nor Slack's own messages (joins, topic changes…).
const DAY_MS = 24 * 60 * 60 * 1000;
const SIX_MONTHS_MS = 182 * DAY_MS;

// Message subtypes that count as activity. Plain messages have no subtype.
const COUNTED_SUBTYPES = new Set([
	'thread_broadcast',
	'file_share',
	'me_message',
]);

/**
 * @typedef {object} Activity
 * @property {Date | null} lastMessageAt Newest message or thread reply from a
 *   person.
 * @property {number} messagesLastSixMonths Top-level messages from people in
 *   the last 6 months. At most 100, as only the newest 100 messages are fetched.
 */

/**
 * Whether a message was posted by a bot or app, including workflows and
 * integrations. Slack gives these a `bot_id`, and older ones the
 * "bot_message" subtype.
 * @param {any} message
 */
const isBotMessage = (message) =>
	message.bot_id !== undefined || message.subtype === 'bot_message';

/**
 * Whether a message counts as activity: posted by a person, not by a bot or
 * app, and not an automatic message from Slack such as someone joining.
 * @param {any} message
 */
export const isCountedMessage = (message) =>
	!isBotMessage(message) &&
	(message.subtype === undefined || COUNTED_SUBTYPES.has(message.subtype));

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
	// has the time of the latest reply. Includes threads under bot messages,
	// as people often reply to those (e.g. to an alert). Slack doesn't say who
	// sent the latest reply, so it's counted even if that was a bot.
	const replyMs = messages
		.filter(
			(message) =>
				message.latest_reply &&
				(isCountedMessage(message) || isBotMessage(message)),
		)
		.map((message) => tsToMs(message.latest_reply));
	const messageMs = counted.map((message) => tsToMs(message.ts));
	const times = [...messageMs, ...replyMs];

	return {
		lastMessageAt: times.length ? new Date(Math.max(...times)) : null,
		messagesLastSixMonths: counted.filter(
			(message) => now - tsToMs(message.ts) < SIX_MONTHS_MS,
		).length,
	};
};

/**
 * Whether a channel has had no messages, from people or bots, in the last 6 months.
 * False if we don't know the channel's activity yet.
 * @param {Activity | undefined} activity
 * @param {number} [now] Current time in ms.
 */
export const isInactive = (activity, now = Date.now()) =>
	activity !== undefined &&
	(activity.lastMessageAt === null ||
		now - activity.lastMessageAt.getTime() >= SIX_MONTHS_MS);
