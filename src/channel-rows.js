// Turns channels into the rows the channels grid (public/channel-grid.js)
// shows. Text is formatted here, so it's the same for everyone whatever their
// browser's settings; the raw values are kept alongside for sorting.

const LONDON_DATE = {timeZone: 'Europe/London'};

/** @param {Date} date */
const formatDate = (date) => date.toLocaleDateString('en-GB', LONDON_DATE);

/**
 * The channel's status, most urgent first: nobody in it (not counting the
 * bot), no messages in 30 days, has messages, or the bot can't see them.
 * @param {any} channel
 * @returns {'empty' | 'inactive' | 'active' | 'unknown' | 'unchecked'}
 */
const statusOf = (channel) => {
	if (channel.memberCount === 0) {
		return 'empty';
	}
	if (channel.inactive) {
		return 'inactive';
	}
	if (channel.activity) {
		return 'active';
	}
	// The bot can only read channels it's in. Ones it is in, but hasn't
	// checked yet, will be soon.
	return channel.isMember ? 'unchecked' : 'unknown';
};

/**
 * One row of the channels grid.
 * @param {any} channel A channel from getChannelData().
 */
export const toGridRow = (channel) => {
	const {activity} = channel;
	const lastMessageAt = activity?.lastMessageAt ?? null;
	const messagesLastMonth = activity?.messagesLastMonth ?? null;

	let lastMessage = '—';
	if (activity) {
		lastMessage = lastMessageAt ? formatDate(lastMessageAt) : 'No messages';
	}

	let messages = '—';
	if (messagesLastMonth !== null) {
		messages = messagesLastMonth >= 100 ? '100+' : String(messagesLastMonth);
	}

	return {
		id: channel.id,
		name: channel.name,
		slackUrl: channel.slackUrl,
		isExternal: Boolean(channel.isExternal),
		purpose: channel.purpose ?? '',
		memberCount: channel.memberCount,
		// Other organisations in a Slack Connect channel, or null if none.
		sharedWith: channel.externalTeams?.length
			? channel.externalTeams.join(', ')
			: null,
		// Unknown (null) if not checked; 0 if nobody has posted, so it sorts
		// as the oldest.
		lastMessageAt: activity ? (lastMessageAt?.getTime() ?? 0) : null,
		lastMessage,
		messagesLastMonth,
		messages,
		status: statusOf(channel),
		canArchive: Boolean(channel.canArchive),
		// Why the dashboard offers to archive it, for the confirmation modal.
		archiveReason: channel.canArchive
			? channel.inactive
				? 'Nobody has posted in this channel in the last 30 days.'
				: 'This channel has fewer than 2 members.'
			: null,
		archivedAt: channel.archivedAt?.getTime() ?? null,
		archived: channel.archivedAt ? formatDate(channel.archivedAt) : '—',
	};
};

/**
 * The rows as JSON, safe to put inside a <script> element: "<" is escaped, so
 * a channel description can't end the element early.
 * @param {ReturnType<typeof toGridRow>[]} rows
 */
export const gridRowsJson = (rows) =>
	JSON.stringify(rows).replaceAll('<', '\\u003c');
