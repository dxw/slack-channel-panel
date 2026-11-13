// Asks to confirm archiving a channel in a modal, instead of going to the
// confirmation page. Without this script, the Archive buttons still go to
// that page.

const dialog = document.getElementById('archive-dialog');

if (dialog) {
	const form = dialog.querySelector('[data-archive-form]');

	// Listens on the whole page, as search.js replaces the table (and its
	// Archive buttons) as you search.
	document.addEventListener('click', (event) => {
		const link = event.target.closest('a[data-archive-name]');
		// Let new-tab clicks (Ctrl, Cmd, Shift, middle button) open the page.
		if (
			!link ||
			event.button !== 0 ||
			event.ctrlKey ||
			event.metaKey ||
			event.shiftKey ||
			event.altKey
		) {
			return;
		}
		event.preventDefault();

		dialog.querySelector('[data-archive-name]').textContent =
			link.dataset.archiveName;
		dialog.querySelector('[data-archive-reason]').textContent =
			link.dataset.archiveReason;
		// The same address the confirmation page posts to.
		form.action = link.pathname;
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
