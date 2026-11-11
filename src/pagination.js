/**
 * Picks one page of items to show.
 * @template T
 * @param {T[]} items All the items, already in order.
 * @param {unknown} requestedPage The page asked for, e.g. from `?page=2`.
 *   Anything that isn't a valid page number shows the nearest real page.
 * @param {number} pageSize How many items per page.
 * @returns {{items: T[], page: number, totalPages: number, from: number, to: number, total: number}}
 *   `from` and `to` are the 1-based positions of the first and last items shown.
 */
export const paginate = (items, requestedPage, pageSize) => {
	const total = items.length;
	const totalPages = Math.max(Math.ceil(total / pageSize), 1);
	const asked = Number.parseInt(String(requestedPage), 10);
	const page = Math.min(
		Math.max(Number.isNaN(asked) ? 1 : asked, 1),
		totalPages,
	);

	const start = (page - 1) * pageSize;
	const pageItems = items.slice(start, start + pageSize);

	return {
		items: pageItems,
		page,
		totalPages,
		from: total === 0 ? 0 : start + 1,
		to: start + pageItems.length,
		total,
	};
};
