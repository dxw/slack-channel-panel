// Shows the channels in an AG Grid table, which sorts and pages through them.
// The rows come from the JSON in #channel-data, which search.js replaces as
// you search. AG Grid (the `agGrid` global) is loaded from a CDN before this.

/* global agGrid */

import {SORT_COLUMNS, compareRows} from './channel-sorting.js';
import {csvValue, csvFileName} from './channel-export.js';

// Tailwind's breakpoints. Less important columns are hidden on smaller
// screens, so the table never scrolls sideways.
const BREAKPOINTS = {sm: '40rem', md: '48rem', lg: '64rem', xl: '80rem'};

const container = document.getElementById('channel-grid');

/**
 * Makes an element. Text is always set as text, never HTML, as it comes from
 * Slack.
 * @param {string} tag
 * @param {Record<string, string>} [attributes]
 * @param {...(Node | string)} children
 */
const element = (tag, attributes = {}, ...children) => {
	const node = document.createElement(tag);
	for (const [name, value] of Object.entries(attributes)) {
		node.setAttribute(name, value);
	}
	node.append(...children);
	return node;
};

/** Vertically centres a cell's content, which can wrap onto 2 lines. */
const centred = (...children) =>
	element('div', {class: 'flex h-full items-center leading-5'}, ...children);

/** Text that wraps onto at most 2 lines, then "…"; hover to see it all. */
const clamped = (text) =>
	centred(
		element(
			'div',
			{class: 'line-clamp-2 break-words text-gray-600', title: text},
			text,
		),
	);

/** The channel's name, linking to it in Slack. Used on both tabs. */
const nameCell = ({data}) => {
	const link = element(
		'a',
		{
			href: data.slackUrl,
			target: '_blank',
			rel: 'noopener',
			class:
				'truncate font-medium underline decoration-gray-300 underline-offset-2 hover:decoration-gray-900',
			title: `Open #${data.name} in Slack`,
		},
		`#${data.name}`,
		element('span', {class: 'sr-only'}, ' (opens in Slack)'),
	);
	const cell = element(
		'div',
		{class: 'flex min-w-0 items-center gap-1.5'},
		link,
	);
	if (data.isExternal) {
		// Slack Connect channel. The badge doesn't shrink, so long names are cut off before it.
		cell.append(
			element(
				'span',
				{
					class:
						'shrink-0 rounded border border-purple-200 bg-purple-50 px-1 text-[10px] leading-4 font-medium text-purple-700 uppercase',
					title: 'Slack Connect: shared with another organisation',
				},
				'Ext',
			),
		);
	}
	return centred(cell);
};

const STATUSES = {
	empty: {
		label: 'Empty',
		class: 'rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800',
		title: 'This channel has no members',
	},
	inactive: {
		label: 'Inactive',
		class: 'rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800',
	},
	active: {
		label: 'Active',
		class: 'rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800',
	},
	unknown: {
		label: 'Unknown',
		class: 'rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700',
		title: 'The bot isn’t in this channel, so it can’t see the messages',
	},
	unchecked: {label: 'Not checked yet', class: 'text-xs text-gray-500'},
};

const statusCell = ({data}) => {
	const status = STATUSES[data.status];
	const attributes = {class: status.class};
	if (status.title) {
		attributes.title = status.title;
	}
	return centred(element('span', attributes, status.label));
};

/** Only for quiet channels that are ours to archive. archive-dialog.js asks to confirm. */
const archiveCell = ({data}) => {
	if (!data.canArchive) {
		return '';
	}
	return centred(
		element(
			'button',
			{
				type: 'button',
				'data-archive-url': `/channels/${data.id}/archive`,
				'data-archive-name': data.name,
				'data-archive-reason': data.archiveReason,
				class:
					'cursor-pointer rounded-md border border-red-300 bg-white px-3 py-1 text-sm font-medium text-red-700 hover:bg-red-50',
			},
			'Archive',
			element('span', {class: 'sr-only'}, ` #${data.name}`),
		),
	);
};

/**
 * A column heading's label, split onto 2 lines before its brackets, e.g.
 * "Messages" then "(6 months)".
 */
class TwoLineHeader {
	init({displayName}) {
		const [first, ...rest] = displayName.split(' (');
		this.gui = element('span', {}, first);
		if (rest.length) {
			this.gui.append(element('br'), `(${rest.join(' (')}`);
		}
	}

	getGui() {
		return this.gui;
	}
}

/**
 * A sortable column, sorted the same way as the old table: unknown values
 * last, ties by name, and starting in the column's first direction.
 * @param {string} colId A key of SORT_COLUMNS.
 * @param {object} colDef An AG Grid column definition.
 */
const sortable = (colId, colDef) => ({
	colId,
	sortingOrder:
		SORT_COLUMNS[colId].firstDirection === 'asc'
			? ['asc', 'desc']
			: ['desc', 'asc'],
	comparator: (_a, _b, nodeA, nodeB, isDescending) =>
		compareRows(nodeA.data, nodeB.data, colId, isDescending),
	...colDef,
});

// Filters, opened from each column heading's filter button.

/** Filters by text, e.g. "contains". */
const textFilter = (filterValueGetter) => ({
	filter: 'agTextColumnFilter',
	...(filterValueGetter && {filterValueGetter}),
});

/** Filters by a number in the row, e.g. "greater than". Unknown values never match. */
const numberFilter = (key) => ({
	filter: 'agNumberColumnFilter',
	filterValueGetter: ({data}) => data[key],
});

/**
 * Compares a date in the grid with the filter's, by day, as the filter
 * expects: negative if the grid's is earlier.
 * @param {Date} filterDate Midnight on the day in the filter.
 * @param {Date} cellDate
 */
const compareDays = (filterDate, cellDate) => {
	const parts = new Intl.DateTimeFormat('en-GB', {
		timeZone: 'Europe/London',
		year: 'numeric',
		month: 'numeric',
		day: 'numeric',
	}).formatToParts(cellDate);
	const part = (type) => Number(parts.find((item) => item.type === type).value);
	const day = new Date(part('year'), part('month') - 1, part('day'));
	return day.getTime() - filterDate.getTime();
};

/** Filters by a date in the row (in ms), e.g. "before". No date never matches. */
const dateFilter = (key) => ({
	filter: 'agDateColumnFilter',
	filterValueGetter: ({data}) => (data[key] ? new Date(data[key]) : null),
	filterParams: {comparator: compareDays},
});

/**
 * A filter with a tick box for each value a column can have, all ticked to
 * start with; untick one to hide those channels. AG Grid's own list filter
 * isn't in the free version.
 */
class TickBoxFilter {
	/**
	 * @param {object} params From AG Grid, with our `options` and `valueOf`
	 *   from the column's `filterParams`.
	 */
	init(params) {
		this.options = params.options;
		this.valueOf = params.valueOf;
		this.filterChanged = params.filterChangedCallback;
		/** The values whose channels are hidden. */
		this.unticked = new Set();

		this.all = element('input', {
			type: 'checkbox',
			class: 'size-4 cursor-pointer accent-gray-900',
		});
		this.all.addEventListener('change', () => {
			this.unticked = new Set(
				this.all.checked ? [] : this.options.map(({value}) => value),
			);
			this.changed();
		});

		this.boxes = this.options.map(({value}) => {
			const box = element('input', {
				type: 'checkbox',
				class: 'size-4 cursor-pointer accent-gray-900',
			});
			box.addEventListener('change', () => {
				if (box.checked) {
					this.unticked.delete(value);
				} else {
					this.unticked.add(value);
				}
				this.changed();
			});
			return box;
		});

		const row = (box, label) =>
			element(
				'label',
				{class: 'flex cursor-pointer items-center gap-2'},
				box,
				label,
			);
		this.gui = element(
			'div',
			{class: 'flex flex-col gap-2 p-3 text-sm'},
			row(this.all, 'Select all'),
			element('hr', {class: 'border-gray-200'}),
			...this.options.map(({label}, i) => row(this.boxes[i], label)),
		);
		this.showTicks();
	}

	getGui() {
		return this.gui;
	}

	/** Updates the tick boxes to match what's unticked. */
	showTicks() {
		this.options.forEach(({value}, i) => {
			this.boxes[i].checked = !this.unticked.has(value);
		});
		const none = this.unticked.size === this.options.length;
		this.all.checked = this.unticked.size === 0;
		// Shows as a dash when only some are ticked.
		this.all.indeterminate = !this.all.checked && !none;
	}

	changed() {
		this.showTicks();
		this.filterChanged();
	}

	isFilterActive() {
		return this.unticked.size > 0;
	}

	doesFilterPass({data}) {
		return !this.unticked.has(this.valueOf(data));
	}

	/** The ticked values, or null if all are (no filter). */
	getModel() {
		if (!this.isFilterActive()) {
			return null;
		}
		return {
			values: this.options
				.map(({value}) => value)
				.filter((value) => !this.unticked.has(value)),
		};
	}

	setModel(model) {
		const ticked = new Set(
			model?.values ?? this.options.map(({value}) => value),
		);
		this.unticked = new Set(
			this.options
				.map(({value}) => value)
				.filter((value) => !ticked.has(value)),
		);
		this.showTicks();
	}
}

/**
 * Filters by tick boxes, one for each option.
 * @param {{value: unknown, label: string}[]} options
 * @param {(data: any) => unknown} valueOf The row's value, one of the options'.
 */
const tickBoxFilter = (options, valueOf) => ({
	filter: TickBoxFilter,
	filterParams: {options, valueOf},
});

const nameColumn = sortable('name', {
	headerName: 'Name',
	field: 'name',
	initialSort: 'asc',
	flex: 1,
	minWidth: 180,
	cellRenderer: nameCell,
	...textFilter(),
});

const descriptionColumn = {
	colId: 'description',
	headerName: 'Description',
	field: 'purpose',
	sortable: false,
	flex: 2,
	minWidth: 200,
	cellRenderer: ({value}) => clamped(value),
};

const COLUMNS = {
	active: [
		nameColumn,
		sortable('members', {
			headerName: 'Members',
			field: 'memberCount',
			// Numbers on the right; the heading stays on the left, like the others.
			cellClass: 'ag-right-aligned-cell',
			width: 110,
			...numberFilter('memberCount'),
		}),
		descriptionColumn,
		sortable('sharedWith', {
			headerName: 'Shared with',
			field: 'sharedWith',
			width: 160,
			cellRenderer: ({value}) => (value ? clamped(value) : ''),
			...textFilter(),
		}),
		sortable('lastMessage', {
			headerName: 'Last message',
			field: 'lastMessage',
			width: 140,
			...dateFilter('lastMessageAt'),
		}),
		sortable('messages', {
			headerName: 'Messages (6 months)',
			headerComponentParams: {innerHeaderComponent: TwoLineHeader},
			field: 'messages',
			cellClass: 'ag-right-aligned-cell',
			width: 130,
			...numberFilter('messagesLastSixMonths'),
		}),
		sortable('status', {
			headerName: 'Status',
			field: 'status',
			width: 140,
			cellRenderer: statusCell,
			...tickBoxFilter(
				Object.entries(STATUSES).map(([value, {label}]) => ({value, label})),
				(data) => data.status,
			),
		}),
		sortable('archive', {
			headerName: 'Archive recommended',
			field: 'canArchive',
			width: 140,
			cellRenderer: archiveCell,
			...tickBoxFilter(
				[
					{value: true, label: 'Yes'},
					{value: false, label: 'No'},
				],
				(data) => data.canArchive,
			),
		}),
	],
	archived: [
		nameColumn,
		descriptionColumn,
		sortable('archived', {
			headerName: 'Archived',
			field: 'archived',
			width: 130,
			...dateFilter('archivedAt'),
		}),
	],
};

/** The smallest screen each column is shown on. Others are always shown. */
const SHOWN_FROM = {
	lastMessage: 'lg',
	members: 'md',
	messages: 'md',
	description: 'lg',
	sharedWith: 'xl',
};

/** The rows in #channel-data. */
const readRows = () =>
	JSON.parse(document.getElementById('channel-data')?.textContent || '[]');

if (container) {
	const status =
		container.dataset.status === 'archived' ? 'archived' : 'active';
	const columns = COLUMNS[status];
	const rows = readRows();

	const theme = agGrid.themeQuartz.withParams({
		fontFamily: 'inherit',
		fontSize: 14,
		foregroundColor: '#111827', // gray-900
		headerTextColor: '#4b5563', // gray-600
		headerBackgroundColor: '#f9fafb', // gray-50
		headerFontWeight: 500,
		borderColor: '#e5e7eb', // gray-200
		accentColor: '#111827', // gray-900, for checkboxes and focus
		wrapperBorderRadius: 8,
		rowHoverColor: '#f9fafb',
	});

	const api = agGrid.createGrid(container, {
		theme,
		columnDefs: columns,
		defaultColDef: {
			suppressMovable: true,
			// Each column says how it's shown and filtered, rather than AG Grid
			// guessing from the values.
			cellDataType: false,
			// Only the filter button: the column menu has nothing useful here.
			suppressHeaderMenuButton: true,
			wrapHeaderText: true,
			autoHeaderHeight: true,
		},
		rowData: rows,
		getRowId: ({data}) => data.id,
		rowHeight: 56,
		domLayout: 'autoHeight',
		// The page says when there are no channels, under the search box. AG
		// Grid still says when the filters hide them all.
		suppressOverlays: ['noRows'],
		pagination: true,
		paginationPageSize: 25,
		paginationPageSizeSelector: [25, 50, 100],
		// Channels that can be archived can be ticked, to archive them together
		// (bulk-archive.js). "Select all" ticks the ones on this page.
		rowSelection:
			status === 'active'
				? {
						mode: 'multiRow',
						isRowSelectable: (node) => Boolean(node.data?.canArchive),
						hideDisabledCheckboxes: true,
						selectAll: 'currentPage',
					}
				: undefined,
		// Lets bulk-archive.js know which channels are ticked.
		onSelectionChanged: (event) => {
			const selected = event.api
				.getSelectedRows()
				.map(({id, name}) => ({id, name}));
			document.dispatchEvent(
				new CustomEvent('channels:selection', {detail: selected}),
			);
		},
		// Unticks channels the filters hide, so "Archive selected" only
		// archives channels you can see.
		onFilterChanged: (event) => {
			const shown = new Set();
			event.api.forEachNodeAfterFilter((node) => shown.add(node));
			const hidden = event.api
				.getSelectedNodes()
				.filter((node) => !shown.has(node));
			if (hidden.length > 0) {
				event.api.setNodesSelected({nodes: hidden, newValue: false});
			}
		},
		// Enter on a cell with a link or button in it (the channel name, or
		// Archive) uses it, so they work from the keyboard.
		onCellKeyDown: ({event}) => {
			if (event?.key === 'Enter' && event.target instanceof HTMLElement) {
				event.target.querySelector('a, button')?.click();
			}
		},
	});

	// Downloads the channels that match the search and filters, from every
	// page, in the order they're sorted.
	const exportButton = document.querySelector('[data-export-csv]');
	/** @param {boolean} hidden */
	const hideGrid = (hidden) => {
		container.hidden = hidden;
		if (exportButton) {
			exportButton.hidden = hidden;
		}
	};
	hideGrid(rows.length === 0);

	/**
	 * A cell's value in the CSV: what's shown in the table, as text.
	 * @param {string} colId
	 * @param {unknown} value
	 */
	const exportValue = (colId, value) => {
		if (colId === 'status') {
			return STATUSES[value]?.label ?? value;
		}
		if (colId === 'archive') {
			return value ? 'Yes' : 'No';
		}
		return value;
	};

	exportButton?.addEventListener('click', () => {
		api.exportDataAsCsv({
			fileName: csvFileName(status, new Date()),
			// Includes the columns hidden on smaller screens.
			allColumns: true,
			processCellCallback: ({column, value}) =>
				csvValue(exportValue(column.getColId(), value)),
		});
	});

	// Shows or hides columns to fit the screen.
	for (const [colId, breakpoint] of Object.entries(SHOWN_FROM)) {
		if (!columns.some((column) => column.colId === colId)) {
			continue;
		}
		const query = window.matchMedia(`(min-width: ${BREAKPOINTS[breakpoint]})`);
		const fit = () => api.setColumnsVisible([colId], query.matches);
		fit();
		query.addEventListener('change', fit);
	}

	// search.js has replaced #channel-data. Keeps the sort and any ticked
	// channels that still match, and goes back to the first page.
	document.addEventListener('channels:updated', () => {
		const updated = readRows();
		api.setGridOption('rowData', updated);
		api.paginationGoToFirstPage();
		hideGrid(updated.length === 0);
	});
}
