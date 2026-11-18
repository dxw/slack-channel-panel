// How the channels grid sorts each column. Used in the browser by
// channel-grid.js, and tested in Node, so it mustn't use anything from either.

/** The order of the Status column, so ascending puts channels needing attention first. */
const STATUS_ORDER = ['empty', 'inactive', 'active', 'unknown', 'unchecked'];

/**
 * @typedef {object} SortColumn
 * @property {(row: any) => string | number | null} value The value to sort
 *   by. `null` means unknown, and always goes last whichever direction.
 * @property {'asc' | 'desc'} firstDirection The direction used when the column
 *   is first clicked: A–Z for names, highest or newest first for numbers and dates.
 */

/** @type {Record<string, SortColumn>} Keyed by the grid column's ID. */
export const SORT_COLUMNS = {
	name: {value: (row) => row.name, firstDirection: 'asc'},
	members: {value: (row) => row.memberCount, firstDirection: 'desc'},
	// A–Z as shown. Channels not shared with anyone go last.
	sharedWith: {value: (row) => row.sharedWith, firstDirection: 'asc'},
	lastMessage: {value: (row) => row.lastMessageAt, firstDirection: 'desc'},
	messages: {value: (row) => row.messagesLastMonth, firstDirection: 'desc'},
	status: {
		value: (row) => STATUS_ORDER.indexOf(row.status),
		firstDirection: 'asc',
	},
	// Channels that can be archived first.
	archive: {value: (row) => (row.canArchive ? 0 : 1), firstDirection: 'asc'},
	archived: {value: (row) => row.archivedAt, firstDirection: 'desc'},
};

/**
 * Compares two rows by a column, the way AG Grid's `comparator` expects: as if
 * sorting ascending, as AG Grid reverses the result itself when descending.
 * Unknown values go last and ties are sorted by name A–Z, whichever direction,
 * so those are reversed in advance to undo AG Grid's reversing.
 * @param {any} a
 * @param {any} b
 * @param {string} column A key of SORT_COLUMNS.
 * @param {boolean} isDescending
 * @returns {number}
 */
export const compareRows = (a, b, column, isDescending) => {
	const {value} = SORT_COLUMNS[column];
	const fixed = isDescending ? -1 : 1;
	const valueA = value(a);
	const valueB = value(b);

	if (valueA === null || valueB === null) {
		if (valueA !== valueB) {
			return (valueA === null ? 1 : -1) * fixed;
		}
	} else if (valueA !== valueB) {
		return typeof valueA === 'string'
			? valueA.localeCompare(String(valueB))
			: valueA - Number(valueB);
	}

	return a.name.localeCompare(b.name) * fixed;
};

/**
 * Sorts rows by a column, as the grid does.
 * @template T
 * @param {T[]} rows
 * @param {string} column A key of SORT_COLUMNS.
 * @param {'asc' | 'desc'} direction
 * @returns {T[]} A new, sorted array.
 */
export const sortRows = (rows, column, direction) => {
	const isDescending = direction === 'desc';
	return rows.toSorted((a, b) => {
		const compared = compareRows(a, b, column, isDescending);
		return isDescending ? -compared : compared;
	});
};
