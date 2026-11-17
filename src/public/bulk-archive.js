// Lets you tick channels that can be archived, or all of them on the page,
// then archive them together after confirming in a modal. Without this
// script, the checkboxes do nothing.

// Named so they don't clash with search.js's and archive-dialog.js's, as
// scripts on a page share their top-level names.
const bulkForm = document.getElementById('bulk-archive-form');
const bulkDialog = document.getElementById('bulk-archive-dialog');

if (bulkForm && bulkDialog) {
	const count = bulkForm.querySelector('[data-bulk-count]');

	/**
	 * The channels' checkboxes. Looked up each time, as search.js replaces the
	 * table as you search.
	 * @returns {HTMLInputElement[]}
	 */
	const checkboxes = () => [
		...document.querySelectorAll('input[data-bulk-select]'),
	];
	const ticked = () => checkboxes().filter((checkbox) => checkbox.checked);

	/** @param {number} n */
	const channels = (n) => `${n} ${n === 1 ? 'channel' : 'channels'}`;

	/** Shows the selection bar if anything is ticked, and updates "select all" to match. */
	const update = () => {
		const total = checkboxes().length;
		const n = ticked().length;
		bulkForm.hidden = n === 0;
		count.textContent = channels(n);

		const selectAll = document.querySelector('[data-select-all]');
		if (selectAll) {
			selectAll.checked = n > 0 && n === total;
			// Shows as a dash when only some are ticked.
			selectAll.indeterminate = n > 0 && n < total;
		}
	};

	// Listens on the whole page, as search.js replaces the checkboxes.
	document.addEventListener('change', (event) => {
		if (event.target.matches('[data-select-all]')) {
			for (const checkbox of checkboxes()) {
				checkbox.checked = event.target.checked;
			}
		}
		if (event.target.matches('[data-select-all], [data-bulk-select]')) {
			update();
		}
	});

	// search.js has replaced the table: its checkboxes start unticked.
	document.addEventListener('channels:updated', () => {
		bulkDialog.close();
		update();
	});
	// When the page loads, including going back to it, as browsers can
	// restore ticked checkboxes.
	window.addEventListener('pageshow', update);

	bulkForm.querySelector('[data-bulk-open]').addEventListener('click', () => {
		const names = ticked().map((checkbox) => checkbox.dataset.name);
		bulkDialog.querySelector('[data-bulk-dialog-count]').textContent = channels(
			names.length,
		);
		bulkDialog.querySelector('[data-bulk-dialog-list]').replaceChildren(
			...names.map((name) => {
				const item = document.createElement('li');
				item.textContent = `#${name}`;
				return item;
			}),
		);
		bulkDialog.showModal();
	});
}
