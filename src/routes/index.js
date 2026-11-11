import express from 'express';
import {getChannelData} from '../slack/index.js';
import {paginate} from '../pagination.js';

const router = express.Router();

const CHANNELS_PER_PAGE = 25;

/**
 * Builds the homepage link for a tab and page, e.g. "/?status=archived&page=2".
 * @param {string} status
 * @param {number} page
 */
const pageUrl = (status, page) => {
	const params = new URLSearchParams();
	if (status === 'archived') {
		params.set('status', 'archived');
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
		shown.toSorted((a, b) => a.name.localeCompare(b.name)),
		req.query.page,
		CHANNELS_PER_PAGE,
	);

	res.render('index', {
		status,
		counts: {active: active.length, archived: archived.length},
		channels: pagination.items,
		pagination: {
			...pagination,
			previousUrl:
				pagination.page > 1 ? pageUrl(status, pagination.page - 1) : null,
			nextUrl:
				pagination.page < pagination.totalPages
					? pageUrl(status, pagination.page + 1)
					: null,
		},
		refreshedAt,
		refreshing,
		progress,
	});
});

export default router;
