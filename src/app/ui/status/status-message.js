import { getStatusIconMarkup } from './status-icons.js';

const STRUCTURED_STATUS_TOKEN_PATTERN = /\[(AB|VM|SM|ANIM|INST)\]\s+/;
const STRUCTURED_STATUS_SEGMENT_PATTERN = /^\[(AB|VM|SM|ANIM|INST)\]\s+(.+)$/;

export function escapeHtml(value, documentRef = globalThis.document) {
    const div = documentRef?.createElement?.('div');
    if (!div) {
        return String(value ?? '');
    }
    div.textContent = String(value ?? '');
    return div.innerHTML;
}

function parseStructuredStatusMessage(message) {
    const fullText = String(message || '').trim();
    if (!fullText) {
        return null;
    }

    const tokenStart = fullText.search(STRUCTURED_STATUS_TOKEN_PATTERN);
    if (tokenStart === -1) {
        return null;
    }

    const prefixLabel = fullText.slice(0, tokenStart).trim().replace(/:\s*$/, '');
    const segmentSource = fullText.slice(tokenStart);
    const items = [];

    for (const segment of segmentSource.split(/\s+·\s+/)) {
        const normalizedSegment = segment.trim();
        const match = normalizedSegment.match(STRUCTURED_STATUS_SEGMENT_PATTERN);
        if (!match) {
            return null;
        }
        const [, token, value] = match;
        const normalizedValue = String(value || '').trim();
        if (!normalizedValue) {
            return null;
        }
        items.push({ token, value: normalizedValue });
    }

    if (items.length === 0) {
        return null;
    }

    return {
        fullText,
        items,
        prefixLabel,
    };
}

export function buildStructuredStatusMarkup(message, documentRef = globalThis.document) {
    const parsed = parseStructuredStatusMessage(message);
    if (!parsed) {
        return null;
    }

    const prefixMarkup = parsed.prefixLabel
        ? `<span class="status-prefix">${escapeHtml(parsed.prefixLabel, documentRef)}:</span>`
        : '';
    const itemsMarkup = parsed.items.map(({ token, value }) => `
        <span class="status-item status-item-${token.toLowerCase()}" data-status-token="${token}">
            <span class="status-item-icon" aria-hidden="true">${getStatusIconMarkup(token)}</span>
            <span class="status-item-value">${escapeHtml(value, documentRef)}</span>
        </span>
    `).join('');

    return {
        markup: `${prefixMarkup}${itemsMarkup}`,
        title: parsed.fullText,
    };
}
