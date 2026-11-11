import express from 'express';
import {getChannelData} from '../slack/index.js';
import {paginate} from '../pagination.js';
import {SORT_COLUMNS, SORTABLE_ON_TAB, sortChannels} from '../sorting.js';

const router = express.Router();

const CHANNELS_PER_PAGE = 25;

/**
 * Builds a homepage link, leaving out anything that's the default,
 * e.g. "/?status=archived&sort=archived&dir=asc&page=2".
 * @param {{status: string, sort: string, dir: string, page?: number}} options
 */
const homeUrl = ({status, sort, dir, page = 1}) => {
	const params = new URLSearchParams();
	if (status === 'archived') {
		params.set('status', 'archived');
	}
	if (sort !== 'name' || dir !== 'asc') {
		params.set('sort', sort);
		params.set('dir', dir);
	}
	if (page > 1) {
		params.set('page', String(page));
	}
	const query = params.toString();
	return query ? `/?${query}` : '/';
};

router.get('/', (req, res) => {
	// Show active channels unless ?status=archived is asked for.
	const status = req.query.status === 'archived' ? 'archived' : 'active';

	// Sort by name A–Z unless another column this tab can sort by is asked for.
	const sortable = SORTABLE_ON_TAB[status];
	const sort = sortable.includes(String(req.query.sort))
		? String(req.query.sort)
		: 'name';
	const dir =
		req.query.dir === 'asc' || req.query.dir === 'desc'
			? req.query.dir
			: SORT_COLUMNS[sort].firstDirection;

	const {channels, refreshedAt, refreshing, progress, error} = getChannelData();

	// Only show an error if there's nothing else to show.
	if (error && channels.length === 0) {
		// 502 Bad Gateway: the page failed because Slack, which we depend on, did.
		return res
			.status(502)
			.render('index', {error: 'Couldn’t load channels from Slack.'});
	}

	const active = channels.filter((channel) => !channel.isArchived);
	const archived = channels.filter((channel) => channel.isArchived);
	const shown = status === 'archived' ? archived : active;

	const pagination = paginate(
		sortChannels(shown, sort, dir),
		req.query.page,
		CHANNELS_PER_PAGE,
	);

	// A link for each sortable column heading. Clicking the current column
	// reverses it; clicking another starts at that column's first direction.
	// Changing the sort goes back to page 1.
	const sortLinks = Object.fromEntries(
		sortable.map((column) => {
			const current = column === sort ? dir : null;
			const nextDir = current
				? current === 'asc'
					? 'desc'
					: 'asc'
				: SORT_COLUMNS[column].firstDirection;
			return [
				column,
				{url: homeUrl({status, sort: column, dir: nextDir}), current},
			];
		}),
	);

	res.render('index', {
		status,
		counts: {active: active.length, archived: archived.length},
		channels: pagination.items,
		sortLinks,
		pagination: {
			...pagination,
			previousUrl:
				pagination.page > 1
					? homeUrl({status, sort, dir, page: pagination.page - 1})
					: null,
			nextUrl:
				pagination.page < pagination.totalPages
					? homeUrl({status, sort, dir, page: pagination.page + 1})
					: null,
		},
		refreshedAt,
		refreshing,
		progress,
	});
});

export default router;
