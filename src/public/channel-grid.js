// Shows the channels in an AG Grid table, which sorts and pages through them.
// The rows come from the JSON in #channel-data, which search.js replaces as
// you search. AG Grid (the `agGrid` global) is loaded from a CDN before this.

/* global agGrid */

import {SORT_COLUMNS, compareRows} from './channel-sorting.js';

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

const nameColumn = sortable('name', {
	headerName: 'Name',
	field: 'name',
	initialSort: 'asc',
	flex: 1,
	minWidth: 180,
	cellRenderer: nameCell,
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
		}),
		descriptionColumn,
		sortable('sharedWith', {
			headerName: 'Shared with',
			field: 'sharedWith',
			width: 160,
			cellRenderer: ({value}) => (value ? clamped(value) : ''),
		}),
		sortable('lastMessage', {
			headerName: 'Last message',
			field: 'lastMessage',
			width: 140,
		}),
		sortable('messages', {
			headerName: 'Messages (6 months)',
			headerComponentParams: {innerHeaderComponent: TwoLineHeader},
			field: 'messages',
			cellClass: 'ag-right-aligned-cell',
			width: 130,
		}),
		sortable('status', {
			headerName: 'Status',
			field: 'status',
			width: 140,
			cellRenderer: statusCell,
		}),
		sortable('archive', {
			headerName: 'Archive recommended',
			field: 'canArchive',
			width: 140,
			cellRenderer: archiveCell,
		}),
	],
	archived: [
		nameColumn,
		descriptionColumn,
		sortable('archived', {
			headerName: 'Archived',
			field: 'archived',
			width: 130,
		}),
	],
};

/** The smallest screen each column is shown on. Others are always shown. */
const SHOWN_FROM = {
	lastMessage: 'sm',
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
			wrapHeaderText: true,
			autoHeaderHeight: true,
		},
		rowData: rows,
		getRowId: ({data}) => data.id,
		rowHeight: 56,
		domLayout: 'autoHeight',
		// The page says when there are no channels, under the search box.
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
		// Enter on a cell with a link or button in it (the channel name, or
		// Archive) uses it, so they work from the keyboard.
		onCellKeyDown: ({event}) => {
			if (event?.key === 'Enter' && event.target instanceof HTMLElement) {
				event.target.querySelector('a, button')?.click();
			}
		},
	});

	container.hidden = rows.length === 0;

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
		container.hidden = updated.length === 0;
	});
}
