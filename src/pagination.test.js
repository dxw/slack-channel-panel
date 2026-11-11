import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {paginate} from './pagination.js';

// The numbers 1 to 55.
const items = Array.from({length: 55}, (_, i) => i + 1);

describe('paginate', () => {
	it('shows the first page by default', () => {
		const result = paginate(items, undefined, 25);

		assert.deepEqual(result.items, items.slice(0, 25));
		assert.equal(result.page, 1);
		assert.equal(result.totalPages, 3);
		assert.equal(result.from, 1);
		assert.equal(result.to, 25);
		assert.equal(result.total, 55);
	});

	it('shows the page asked for', () => {
		const result = paginate(items, '2', 25);

		assert.deepEqual(result.items, items.slice(25, 50));
		assert.equal(result.from, 26);
		assert.equal(result.to, 50);
	});

	it('shows a shorter last page', () => {
		const result = paginate(items, '3', 25);

		assert.deepEqual(result.items, [51, 52, 53, 54, 55]);
		assert.equal(result.to, 55);
	});

	it('shows the nearest real page for out-of-range or invalid pages', () => {
		assert.equal(paginate(items, '99', 25).page, 3);
		assert.equal(paginate(items, '0', 25).page, 1);
		assert.equal(paginate(items, '-4', 25).page, 1);
		assert.equal(paginate(items, 'abc', 25).page, 1);
	});

	it('has one empty page when there are no items', () => {
		assert.deepEqual(paginate([], '1', 25), {
			items: [],
			page: 1,
			totalPages: 1,
			from: 0,
			to: 0,
			total: 0,
		});
	});
});
