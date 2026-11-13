// Asks to confirm archiving a channel in a modal. The Archive buttons only
// work with this script.

const dialog = document.getElementById('archive-dialog');

if (dialog) {
	const form = dialog.querySelector('[data-archive-form]');

	// Listens on the whole page, as search.js replaces the table (and its
	// Archive buttons) as you search.
	document.addEventListener('click', (event) => {
		const button = event.target.closest('button[data-archive-url]');
		if (!button) {
			return;
		}

		dialog.querySelector('[data-archive-name]').textContent =
			button.dataset.archiveName;
		dialog.querySelector('[data-archive-reason]').textContent =
			button.dataset.archiveReason;
		form.action = button.dataset.archiveUrl;
		dialog.showModal();
	});

	// Clicking the dark backdrop around the dialog closes it. Clicks on the
	// backdrop count as clicks on the dialog, so check they're outside its box.
	dialog.addEventListener('click', (event) => {
		const box = dialog.getBoundingClientRect();
		const outside =
			event.clientX < box.left ||
			event.clientX > box.right ||
			event.clientY < box.top ||
			event.clientY > box.bottom;
		if (event.target === dialog && outside) {
			dialog.close();
		}
	});
}
