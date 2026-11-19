import express from 'express';
import {
	getChannelData,
	getChannel,
	archiveChannelById,
	NotArchivableError,
	startBulkArchive,
	BulkArchiveRunningError,
	MAX_BULK_ARCHIVE,
} from '../slack/index.js';
import {toGridRow, gridRowsJson} from '../channel-rows.js';

const router = express.Router();

/**
 * Builds a homepage link, leaving out anything that's the default,
 * e.g. "/?status=archived&q=project".
 * @param {{status: string, q?: string}} options
 */
const homeUrl = ({status, q = ''}) => {
	const params = new URLSearchParams();
	if (status === 'archived') {
		params.set('status', 'archived');
	}
	if (q) {
		params.set('q', q);
	}
	const query = params.toString();
	return query ? `/?${query}` : '/';
};

router.get('/', (req, res) => {
	// Show active channels unless ?status=archived is asked for.
	const status = req.query.status === 'archived' ? 'archived' : 'active';

	// Search text for channel names. A leading "#" is ignored, so "#dev"
	// finds the same channels as "dev".
	const q = String(req.query.q ?? '').trim();
	const search = q.replace(/^#/, '').toLowerCase();

	const {channels, refreshedAt, refreshing, error, bulkArchive} =
		getChannelData();

	// A one-off message from the last action, e.g. archiving a channel.
	const notice = req.session.notice;
	delete req.session.notice;

	// How a bulk archive went, shown once it's finished, and only to the
	// person who started it. Everyone sees that one is running.
	let bulkArchiveSummary = null;
	if (
		bulkArchive &&
		!bulkArchive.running &&
		req.session.bulkArchiveId === bulkArchive.id
	) {
		bulkArchiveSummary = bulkArchive;
		delete req.session.bulkArchiveId;
	}

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

	// The grid (public/channel-grid.js) sorts and pages through these.
	res.render('index', {
		status,
		q,
		// Switching tab keeps the search.
		tabUrls: {
			active: homeUrl({status: 'active', q}),
			archived: homeUrl({status: 'archived', q}),
		},
		counts: {active: active.length, archived: archived.length},
		total: shown.length,
		rowsJson: gridRowsJson(shown.map(toGridRow)),
		refreshedAt,
		refreshing,
		notice,
		bulkArchiving: bulkArchive?.running ? bulkArchive : null,
		bulkArchiveSummary,
		maxBulkArchive: MAX_BULK_ARCHIVE,
	});
});

// Starts archiving the ticked channels in the background, then goes back to
// the dashboard, which shows the progress. The dashboard asks to confirm
// first, in a modal.
router.post('/channels/archive', (req, res) => {
	// One ID is sent as a string, several as an array. There's no body at all
	// if nothing was sent, as Express 5 leaves req.body undefined.
	const ids = [...new Set([req.body?.ids ?? []].flat().map(String))];
	if (ids.length === 0) {
		req.session.notice = {
			type: 'error',
			text: 'Select at least one channel to archive.',
		};
		return res.redirect('/');
	}
	if (ids.length > MAX_BULK_ARCHIVE) {
		req.session.notice = {
			type: 'error',
			text: `You can archive at most ${MAX_BULK_ARCHIVE} channels at a time.`,
		};
		return res.redirect('/');
	}
	try {
		req.session.bulkArchiveId = startBulkArchive({
			ids,
			token: process.env.SLACK_BOT_TOKEN,
		});
	} catch (error) {
		if (!(error instanceof BulkArchiveRunningError)) {
			throw error;
		}
		req.session.notice = {
			type: 'error',
			text: 'Some channels are already being archived. Try again when that’s finished.',
		};
	}
	res.redirect('/');
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
