// Saves the channel data to a file in development, so restarting the server
// (e.g. when nodemon sees a code change) doesn't start a fresh Slack refresh,
// which can take several minutes. Not used in production.

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

/** Where the data is saved. Delete this file to refresh from Slack on the next start. */
export const CACHE_FILE = fileURLToPath(
	new URL('../../.cache/channels.json', import.meta.url),
);

// Bump this when the shape of the saved data changes (e.g. a new field on
// Channel), so older files are ignored instead of loaded with missing fields.
const CACHE_VERSION = 1;

/** @typedef {import('./api.js').Channel} Channel */
/** @typedef {import('./activity.js').Activity} Activity */

/**
 * @typedef {object} CachedData
 * @property {Channel[]} channels
 * @property {Map<string, Activity>} activity
 * @property {Map<string, string>} teamNames
 * @property {string | null} ownTeamId
 * @property {Date} refreshedAt
 */

/**
 * Saves the channel data to a file, creating its folder if needed.
 * @param {string} file
 * @param {CachedData} data
 */
export const saveCache = (file, data) => {
	fs.mkdirSync(path.dirname(file), {recursive: true});
	fs.writeFileSync(
		file,
		JSON.stringify({
			version: CACHE_VERSION,
			channels: data.channels,
			activity: [...data.activity],
			teamNames: [...data.teamNames],
			ownTeamId: data.ownTeamId,
			refreshedAt: data.refreshedAt,
		}),
	);
};

/**
 * @param {string | null} value
 */
const toDate = (value) => (value === null ? null : new Date(value));

/**
 * Loads channel data saved by saveCache. Returns null if there's no file, it
 * can't be read, or it was saved in an older format.
 * @param {string} file
 * @returns {CachedData | null}
 */
export const loadCache = (file) => {
	let json;
	try {
		json = JSON.parse(fs.readFileSync(file, 'utf8'));
	} catch {
		return null;
	}
	if (json.version !== CACHE_VERSION) {
		return null;
	}

	// JSON has no dates, so turn the date strings back into Dates.
	return {
		channels: json.channels.map((channel) => ({
			...channel,
			created: new Date(channel.created),
			archivedAt: toDate(channel.archivedAt),
		})),
		activity: new Map(
			json.activity.map(([id, activity]) => [
				id,
				{...activity, lastMessageAt: toDate(activity.lastMessageAt)},
			]),
		),
		teamNames: new Map(json.teamNames),
		ownTeamId: json.ownTeamId,
		refreshedAt: new Date(json.refreshedAt),
	};
};
