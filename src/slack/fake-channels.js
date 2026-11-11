// Made-up channels in the shape Slack's conversations.list returns them.
// Used when SLACK_FAKE_DATA=true, so the app can run without a Slack token.

const DAY_SECONDS = 24 * 60 * 60;
const NOW_SECONDS = Math.floor(Date.now() / 1000);

const names = [
	'general',
	'random',
	'announcements',
	'dev',
	'design',
	'support',
	'ops-alerts',
	'project-apollo',
	'project-borealis',
	'project-cobalt',
	'social',
	'pets',
	'book-club',
	'running',
	'help-it',
	'old-website',
	'hackday-2019',
	'recruitment',
	'learning',
	'music',
];

export const fakeChannels = names.map((name, i) => ({
	id: `CFAKE${String(i).padStart(4, '0')}`,
	name,
	is_archived: name === 'old-website' || name === 'hackday-2019',
	num_members: (i * 37) % 120,
	topic: {value: ''},
	purpose: {value: `A made-up channel for ${name.replaceAll('-', ' ')}`},
	created: NOW_SECONDS - (i + 1) * 90 * DAY_SECONDS,
}));
