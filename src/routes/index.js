import express from 'express';
import {
	getChannelData,
	getChannel,
	archiveChannelById,
	NotArchivableError,
} from '../slack/index.js';
import {paginate} from '../pagination.js';
import {SORT_COLUMNS, SORTABLE_ON_TAB, sortChannels} from '../sorting.js';

const router = express.Router();

const CHANNELS_PER_PAGE = 25;

/**
 * Builds a homepage link, leaving out anything that's the default,
 * e.g. "/?status=archived&q=project&sort=archived&dir=asc&page=2".
 * @param {{status: string, q?: string, sort: string, dir: string, page?: number}} options
 */
const homeUrl = ({status, q = '', sort, dir, page = 1}) => {
	const params = new URLSearchParams();
	if (status === 'archived') {
		params.set('status', 'archived');
	}
	if (q) {
		params.set('q', q);
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

	// Search text for channel names. A leading "#" is ignored, so "#dev"
	// finds the same channels as "dev".
	const q = String(req.query.q ?? '').trim();
	const search = q.replace(/^#/, '').toLowerCase();

	const {channels, refreshedAt, refreshing, progress, error} = getChannelData();

	// A one-off message from the last action, e.g. archiving a channel.
	const notice = req.session.notice;
	delete req.session.notice;

	// Only show an error if there's nothing else to show.
	if (error && channels.length === 0) {
		// 502 Bad Gateway: the page failed because Slack fetch did.
		return res
			.status(502)
			.render('index', {error: 'Couldn’t load channels from Slack.'});
	}

	// Update active/archived tab counts to be the number of channels matching the search.
	const matching = channels.filter((channel) =>
		channel.name.toLowerCase().includes(search),
	);
	const active = matching.filter((channel) => !channel.isArchived);
	const archived = matching.filter((channel) => channel.isArchived);
	const shown = status === 'archived' ? archived : active;

	const pagination = paginate(
		sortChannels(shown, sort, dir),
		req.query.page,
		CHANNELS_PER_PAGE,
	);

	// A link for each sortable column heading. Clicking the current column
	// reverses it; clicking another starts at that column's first direction.
	// Changing the sort goes back to page 1. Links keep the search.
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
				{url: homeUrl({status, q, sort: column, dir: nextDir}), current},
			];
		}),
	);

	res.render('index', {
		status,
		q,
		sort,
		dir,
		// Switching tab keeps the search, but goes back to the default sort,
		// as the tabs have different columns.
		tabUrls: {
			active: homeUrl({status: 'active', q, sort: 'name', dir: 'asc'}),
			archived: homeUrl({status: 'archived', q, sort: 'name', dir: 'asc'}),
		},
		counts: {active: active.length, archived: archived.length},
		channels: pagination.items,
		sortLinks,
		pagination: {
			...pagination,
			previousUrl:
				pagination.page > 1
					? homeUrl({status, q, sort, dir, page: pagination.page - 1})
					: null,
			nextUrl:
				pagination.page < pagination.totalPages
					? homeUrl({status, q, sort, dir, page: pagination.page + 1})
					: null,
		},
		refreshedAt,
		refreshing,
		progress,
		notice,
	});
});

// Archives a channel, then goes back to the dashboard with a message. The
// dashboard asks to confirm first, in a modal.
router.post('/channels/:id/archive', async (req, res) => {
	const channel = getChannel(req.params.id);
	if (!channel?.canArchive) {
		req.session.notice = {
			type: 'error',
			text: 'That channel can’t be archived from the dashboard.',
		};
		return res.redirect('/');
	}
	try {
		await archiveChannelById({
			id: channel.id,
			token: process.env.SLACK_BOT_TOKEN,
		});
		req.session.notice = {type: 'success', text: `#${channel.name} archived.`};
	} catch (error) {
		console.error(`Couldn’t archive #${channel.name}: ${error.message}`);
		req.session.notice = {
			type: 'error',
			text:
				error instanceof NotArchivableError
					? `#${channel.name} wasn’t archived: it has had new messages or members since the dashboard last checked.`
					: `Couldn’t archive #${channel.name}. Try again, or archive it in Slack.`,
		};
	}
	res.redirect('/');
});

export default router;
