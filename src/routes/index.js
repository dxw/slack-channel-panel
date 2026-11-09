import express from 'express';
import {getChannels} from '../slack/index.js';

const router = express.Router();

router.get('/', async (req, res) => {
	try {
		const {channels, fetchedAt} = await getChannels();
		res.render('index', {
			channels: channels.toSorted((a, b) => a.name.localeCompare(b.name)),
			fetchedAt: new Date(fetchedAt),
		});
	} catch (error) {
		console.error(error.message);
		res.render('index', {error: 'Couldn’t load channels from Slack.'});
	}
});

export default router;
