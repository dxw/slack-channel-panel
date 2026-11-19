import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {csvValue, csvFileName} from './public/channel-export.js';

describe('csvValue', () => {
	it('stops spreadsheets running text as a formula', () => {
		assert.equal(csvValue('=SUM(A1:A2)'), "'=SUM(A1:A2)");
		assert.equal(csvValue('+1'), "'+1");
		assert.equal(csvValue('-x'), "'-x");
		assert.equal(csvValue('@x'), "'@x");
		assert.equal(csvValue('\tx'), "'\tx");
	});

	it('leaves other text, numbers and empty values alone', () => {
		assert.equal(csvValue('general'), 'general');
		assert.equal(csvValue('100+'), '100+');
		assert.equal(csvValue(-3), -3);
		assert.equal(csvValue(42), 42);
		assert.equal(csvValue(null), null);
	});
});

describe('csvFileName', () => {
	it('names the file after the tab and the date', () => {
		const date = new Date('2026-11-19T12:00:00Z');

		assert.equal(csvFileName('active', date), 'slack-channels-active-2026-11-19.csv');
		assert.equal(
			csvFileName('archived', date),
			'slack-channels-archived-2026-11-19.csv',
		);
	});
});
