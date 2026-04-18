// Keep one dormant family-journal prefix so multi-family can come back later
// without rebuilding ID shape from scratch.
export const JOURNAL_PREFIX = 'journal_family';

export const buildJournalId = (suffix = '01') => `${JOURNAL_PREFIX}_${suffix}`;

export const DEFAULT_JOURNAL_ID = buildJournalId();
