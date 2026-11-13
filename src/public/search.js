// Updates the channel list as you type in the search box, without reloading
// the page. Waits until you stop typing, so it doesn't load the page on every
// key. Without this script, the search still works by pressing Enter.

const DEBOUNCE_MS = 300;

// The parts of the page that change with the search, by ID.
const UPDATED_IDS = ['channel-tabs', 'channel-results'];

const form = document.querySelector('[data-channel-search]');

if (form) {
	const status = document.getElementById('search-status');
	let timer;
	let controller;

	/** The page URL for what's in the form, leaving out an empty search. */
	const searchUrl = () => {
		const params = new URLSearchParams(new FormData(form));
		if (!params.get('q')?.trim()) {
			params.delete('q');
		}
		const query = params.toString();
		return query ? `/?${query}` : '/';
	};

	const update = async () => {
		const url = searchUrl();
		// Only the latest search matters, so cancel one still loading.
		controller?.abort();
		controller = new AbortController();

		try {
			const res = await fetch(url, {signal: controller.signal});
			if (!res.ok) {
				throw new Error(`HTTP ${res.status}`);
			}
			const page = new DOMParser().parseFromString(
				await res.text(),
				'text/html',
			);
			// E.g. the session expired and we were sent to the login page.
			if (!page.getElementById('channel-results')) {
				throw new Error('Not the channels page');
			}

			for (const id of UPDATED_IDS) {
				document.getElementById(id)?.replaceWith(page.getElementById(id));
			}
			history.replaceState(null, '', url);
			status.textContent =
				page.getElementById('search-summary')?.textContent ?? '';
		} catch (error) {
			if (error.name !== 'AbortError') {
				// Fall back to loading the page normally.
				window.location.assign(url);
			}
		}
	};

	form.addEventListener('input', () => {
		clearTimeout(timer);
		timer = setTimeout(update, DEBOUNCE_MS);
	});

	// Pressing Enter searches straight away.
	form.addEventListener('submit', (event) => {
		event.preventDefault();
		clearTimeout(timer);
		update();
	});
}
