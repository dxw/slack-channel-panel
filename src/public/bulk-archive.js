// Archives the channels ticked in the grid together, after confirming in a
// modal. channel-grid.js says which are ticked; this puts their IDs in the
// form, and shows the selection bar while any are ticked.

// Named so they don't clash with search.js's and archive-dialog.js's, as
// scripts on a page share their top-level names.
const bulkForm = document.getElementById('bulk-archive-form');
const bulkDialog = document.getElementById('bulk-archive-dialog');

if (bulkForm && bulkDialog) {
	const count = bulkForm.querySelector('[data-bulk-count]');
	const ids = bulkForm.querySelector('[data-bulk-ids]');
	// The most channels that can be archived at once, from the server
	// (MAX_BULK_ARCHIVE in slack/index.js).
	const maxBulkArchive = Number(bulkForm.dataset.max);

	/** @param {number} n */
	const channels = (n) => `${n} ${n === 1 ? 'channel' : 'channels'}`;

	/** @type {{id: string, name: string}[]} */
	let selected = [];

	// channel-grid.js sends this whenever the ticked channels change: when you
	// tick or untick one, and when searching or filtering hides some.
	document.addEventListener('channels:selection', (event) => {
		selected = event.detail;
		bulkForm.hidden = selected.length === 0;
		count.textContent = channels(selected.length);

		const overLimit = selected.length > maxBulkArchive;
		const openButton = bulkForm.querySelector('[data-bulk-open]');
		openButton.disabled = overLimit;
		openButton.textContent = overLimit
			? `Select at most ${maxBulkArchive} channels`
			: 'Archive selected';
		if (overLimit) {
			bulkDialog.close();
		}

		ids.replaceChildren(
			...selected.map(({id}) =>
				Object.assign(document.createElement('input'), {
					type: 'hidden',
					name: 'ids',
					value: id,
				}),
			),
		);
	});

	// search.js has changed the channels, so the list in the modal may be out of date.
	document.addEventListener('channels:updated', () => {
		bulkDialog.close();
	});

	bulkForm.querySelector('[data-bulk-open]').addEventListener('click', () => {
		bulkDialog.querySelector('[data-bulk-dialog-count]').textContent = channels(
			selected.length,
		);
		bulkDialog.querySelector('[data-bulk-dialog-list]').replaceChildren(
			...selected.map(({name}) => {
				const item = document.createElement('li');
				item.textContent = `#${name}`;
				return item;
			}),
		);
		bulkDialog.showModal();
	});
}
