import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {toGridRow, gridRowsJson} from './channel-rows.js';

/** @type {(extra?: object) => object} */
const channel = (extra = {}) => ({
	id: 'C1',
	name: 'general',
	slackUrl: 'https://slack.com/app_redirect?channel=C1',
	purpose: 'Chat',
	memberCount: 3,
	isMember: true,
	inactive: false,
	activity: undefined,
	archivedAt: null,
	canArchive: false,
	externalTeams: [],
	...extra,
});

describe('toGridRow', () => {
	it('formats dates in London time', () => {
		const lastMessageAt = new Date('2026-06-30T23:30:00Z');
		const row = toGridRow(
			channel({activity: {lastMessageAt, messagesLastSixMonths: 3}}),
		);

		// 00:30 on 1 July in London.
		assert.equal(row.lastMessage, '01/07/2026');
		assert.equal(row.lastMessageAt, lastMessageAt.getTime());
	});

	it('shows unknown activity as a dash, and none as "No messages"', () => {
		const unknown = toGridRow(channel());
		const none = toGridRow(
			channel({activity: {lastMessageAt: null, messagesLastSixMonths: 0}}),
		);

		assert.equal(unknown.lastMessage, '—');
		assert.equal(unknown.lastMessageAt, null);
		assert.equal(unknown.messages, '—');
		assert.equal(none.lastMessage, 'No messages');
		assert.equal(none.lastMessageAt, 0);
		assert.equal(none.messages, '0');
	});

	it('shows 100 or more messages as "100+"', () => {
		const row = toGridRow(
			channel({
				activity: {lastMessageAt: new Date(), messagesLastSixMonths: 150},
			}),
		);

		assert.equal(row.messages, '100+');
		assert.equal(row.messagesLastSixMonths, 150);
	});

	it('works out the status, most urgent first', () => {
		const status = (extra) => toGridRow(channel(extra)).status;
		const activity = {lastMessageAt: null, messagesLastSixMonths: 0};

		assert.equal(status({memberCount: 0, inactive: true, activity}), 'empty');
		assert.equal(status({inactive: true, activity}), 'inactive');
		assert.equal(status({activity}), 'active');
		assert.equal(status({isMember: false}), 'unknown');
		assert.equal(status({}), 'unchecked');
	});

	it('says why a channel can be archived', () => {
		assert.equal(
			toGridRow(channel({canArchive: true, inactive: true})).archiveReason,
			'Nobody has posted in this channel in the last 6 months.',
		);
		assert.equal(
			toGridRow(channel({canArchive: true, memberCount: 1})).archiveReason,
			'This channel has fewer than 2 members.',
		);
		assert.equal(toGridRow(channel()).archiveReason, null);
	});

	it('lists who a channel is shared with', () => {
		assert.equal(
			toGridRow(channel({externalTeams: ['Alpha Co', 'Zeta Ltd']})).sharedWith,
			'Alpha Co, Zeta Ltd',
		);
		assert.equal(toGridRow(channel()).sharedWith, null);
	});
});

describe('gridRowsJson', () => {
	it('escapes "<", so a description can’t end the script element', () => {
		const json = gridRowsJson([
			toGridRow(channel({purpose: '</script><script>alert(1)</script>'})),
		]);

		assert.ok(!json.includes('<'));
		assert.equal(
			JSON.parse(json)[0].purpose,
			'</script><script>alert(1)</script>',
		);
	});
});
