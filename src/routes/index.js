import express from 'express';
import {getChannels} from '../slack/index.js';

const router = express.Router();

router.get('/', async (req, res) => {
	// Show active channels unless ?status=archived is asked for.
	const status = req.query.status === 'archived' ? 'archived' : 'active';

	try {
		const {channels, fetchedAt} = await getChannels();
		const active = channels.filter((channel) => !channel.isArchived);
		const archived = channels.filter((channel) => channel.isArchived);
		const shown = status === 'archived' ? archived : active;

		res.render('index', {
			status,
			counts: {active: active.length, archived: archived.length},
			channels: shown.toSorted((a, b) => a.name.localeCompare(b.name)),
			fetchedAt: new Date(fetchedAt),
		});
	} catch (error) {
		console.error(error.message);
		res.render('index', {error: 'Couldn’t load channels from Slack.'});
	}
});

export default router;
