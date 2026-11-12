import app from './app.js';
import {startChannelRefresh} from './slack/index.js';

const PORT = process.env.PORT || 3000;

// Start server
app.listen(PORT, () => {
	console.log(`Server running at http://localhost:${PORT}`);
});

// Load channel data from Slack now and every few hours.
startChannelRefresh();
