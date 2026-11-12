import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {isHumanMessage, summariseActivity, isInactive} from './activity.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const now = Date.parse('2026-11-10T12:00:00Z');

/**
 * A Slack timestamp for a number of days before `now`.
 * @param {number} days
 */
const daysAgo = (days) => String((now - days * DAY_MS) / 1000);

/** @type {(days: number, extra?: object) => object} */
const post = (days, extra = {}) => ({
	type: 'message',
	user: 'U1',
	ts: daysAgo(days),
	...extra,
});

describe('isHumanMessage', () => {
	it('counts plain posts, file shares and thread broadcasts', () => {
		assert.ok(isHumanMessage(post(1)));
		assert.ok(isHumanMessage(post(1, {subtype: 'file_share'})));
		assert.ok(isHumanMessage(post(1, {subtype: 'thread_broadcast'})));
	});

	it('ignores joins, leaves, topic changes and bots', () => {
		assert.ok(!isHumanMessage(post(1, {subtype: 'channel_join'})));
		assert.ok(!isHumanMessage(post(1, {subtype: 'channel_leave'})));
		assert.ok(!isHumanMessage(post(1, {subtype: 'channel_topic'})));
		assert.ok(!isHumanMessage(post(1, {subtype: 'bot_message', bot_id: 'B1'})));
		assert.ok(!isHumanMessage(post(1, {bot_id: 'B1'})));
	});
});

describe('summariseActivity', () => {
	it('finds the last message and counts the last 30 days', () => {
		const activity = summariseActivity(
			[post(1), post(10), post(29), post(30), post(45)],
			now,
		);

		assert.deepEqual(activity, {
			lastMessageAt: new Date(now - DAY_MS),
			messagesLastMonth: 3,
		});
	});

	it('ignores messages that are not from people', () => {
		const activity = summariseActivity(
			[post(0, {subtype: 'channel_join'}), post(0, {bot_id: 'B1'}), post(40)],
			now,
		);

		assert.deepEqual(activity, {
			lastMessageAt: new Date(now - 40 * DAY_MS),
			messagesLastMonth: 0,
		});
	});

	it('counts a recent thread reply as the last message', () => {
		const activity = summariseActivity(
			[post(20, {reply_count: 2, latest_reply: daysAgo(2)})],
			now,
		);

		assert.deepEqual(activity.lastMessageAt, new Date(now - 2 * DAY_MS));
	});

	it('returns no last message when no person has posted', () => {
		assert.deepEqual(
			summariseActivity([post(1, {subtype: 'channel_join'})], now),
			{lastMessageAt: null, messagesLastMonth: 0},
		);
	});
});

describe('isInactive', () => {
	it('is true when the last message was 30 or more days ago', () => {
		assert.ok(
			isInactive(
				{lastMessageAt: new Date(now - 30 * DAY_MS), messagesLastMonth: 0},
				now,
			),
		);
	});

	it('is true when no person has ever posted', () => {
		assert.ok(isInactive({lastMessageAt: null, messagesLastMonth: 0}, now));
	});

	it('is false when there was a message in the last 30 days', () => {
		assert.ok(
			!isInactive(
				{lastMessageAt: new Date(now - 29 * DAY_MS), messagesLastMonth: 1},
				now,
			),
		);
	});

	it('is false when activity is not known yet', () => {
		assert.ok(!isInactive(undefined, now));
	});
});
