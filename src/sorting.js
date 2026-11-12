// Sorting for the channels table. Each column you can sort by has a value to
// compare and the direction it sorts in when first clicked.

/**
 * @typedef {object} SortColumn
 * @property {(channel: any) => string | number | null} value The value to sort
 *   by. `null` means unknown, and always goes last whichever direction.
 * @property {'asc' | 'desc'} firstDirection The direction used when the column
 *   is first clicked: A–Z for names, highest or newest first for numbers and dates.
 */

/**
 * The order of the Status column, smallest first, so sorting it ascending
 * puts the channels that need attention at the top.
 * @param {any} channel
 */
const statusRank = (channel) => {
	if (channel.inactive) {
		return 0;
	}
	if (channel.activity) {
		return 1;
	}
	return channel.isMember ? 3 : 2; // Not checked yet : Unknown (bot not in channel)
};

/** @type {Record<string, SortColumn>} */
export const SORT_COLUMNS = {
	name: {value: (channel) => channel.name, firstDirection: 'asc'},
	members: {value: (channel) => channel.memberCount, firstDirection: 'desc'},
	lastMessage: {
		// A channel nobody has posted in sorts as the oldest.
		value: (channel) =>
			channel.activity
				? (channel.activity.lastMessageAt?.getTime() ?? 0)
				: null,
		firstDirection: 'desc',
	},
	messages: {
		value: (channel) => channel.activity?.messagesLastMonth ?? null,
		firstDirection: 'desc',
	},
	status: {value: statusRank, firstDirection: 'asc'},
	// Channels that can be archived first.
	archive: {
		value: (channel) => (channel.canArchive ? 0 : 1),
		firstDirection: 'asc',
	},
	archived: {
		value: (channel) => channel.archivedAt?.getTime() ?? null,
		firstDirection: 'desc',
	},
};

/** Which columns can be sorted on each tab. */
export const SORTABLE_ON_TAB = {
	active: ['name', 'members', 'lastMessage', 'messages', 'status', 'archive'],
	archived: ['name', 'archived'],
};

/**
 * Sorts channels by a column. Unknown values go last, and channels with the
 * same value are sorted by name.
 * @template T
 * @param {T[]} channels
 * @param {string} column A key of SORT_COLUMNS.
 * @param {'asc' | 'desc'} direction
 * @returns {T[]} A new, sorted array.
 */
export const sortChannels = (channels, column, direction) => {
	const {value} = SORT_COLUMNS[column];
	const flip = direction === 'desc' ? -1 : 1;

	return channels.toSorted((a, b) => {
		const valueA = value(a);
		const valueB = value(b);

		if (valueA === null || valueB === null) {
			if (valueA !== valueB) {
				return valueA === null ? 1 : -1; // Unknown always goes last.
			}
		} else if (valueA !== valueB) {
			const compared =
				typeof valueA === 'string'
					? valueA.localeCompare(String(valueB))
					: valueA - Number(valueB);
			return compared * flip;
		}

		return a.name.localeCompare(b.name);
	});
};
