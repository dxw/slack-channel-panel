// Helpers for downloading the grid as a CSV file (channel-grid.js).

// Spreadsheets run cells that start with these as formulas. Channel names,
// descriptions and team names come from Slack users, so they're escaped.
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * A value that's safe to put in a CSV cell: text that a spreadsheet would run
 * as a formula gets a leading ' so it's shown as text instead.
 * @param {unknown} value
 */
export const csvValue = (value) =>
	typeof value === 'string' && FORMULA_START.test(value) ? `'${value}` : value;

/**
 * The name for the downloaded file, such as slack-channels-active-2026-11-19.csv.
 * @param {string} status The tab: 'active' or 'archived'.
 * @param {Date} date
 */
export const csvFileName = (status, date) =>
	`slack-channels-${status}-${date.toISOString().slice(0, 10)}.csv`;
