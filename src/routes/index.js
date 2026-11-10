import express from 'express';
import {getChannelData} from '../slack/index.js';

const router = express.Router();

router.get('/', (req, res) => {
	// Show active channels unless ?status=archived is asked for.
	const status = req.query.status === 'archived' ? 'archived' : 'active';

	const {channels, refreshedAt, refreshing, progress, error} = getChannelData();
	const active = channels.filter((channel) => !channel.isArchived);
	const archived = channels.filter((channel) => channel.isArchived);
	const shown = status === 'archived' ? archived : active;

	res.render('index', {
		status,
		counts: {active: active.length, archived: archived.length},
		channels: shown.toSorted((a, b) => a.name.localeCompare(b.name)),
		refreshedAt,
		refreshing,
		progress,
		// Only show an error if there's nothing else to show.
		error:
			error && channels.length === 0
				? 'Couldn’t load channels from Slack.'
				: null,
	});
});

export default router;
