const baseAttributes = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="3"';

export const STATUS_ICON_MARKUP = {
    AB: `
        <svg class="status-item-icon-svg" viewBox="0 0 48 48" aria-hidden="true">
            <line x1="1.5" y1="9.71297" x2="46.5" y2="9.71297" ${baseAttributes}></line>
            <line x1="1.5" y1="38.71245" x2="46.5" y2="38.71245" ${baseAttributes}></line>
            <line x1="38.49974" y1="1.5" x2="38.49974" y2="46.5" ${baseAttributes}></line>
            <line x1="9.50026" y1="1.5" x2="9.50026" y2="46.5" ${baseAttributes}></line>
        </svg>
    `,
    VM: `
        <svg class="status-item-icon-svg" viewBox="0 0 48 48" aria-hidden="true">
            <polygon points="1.5 9.6063 24.01464 17.85582 24.01464 46.5 1.5 37.79217 1.5 9.6063" ${baseAttributes}></polygon>
            <polygon points="46.5 9.6063 24.01464 17.85582 24.01464 46.5 46.5 37.79217 46.5 9.6063" ${baseAttributes}></polygon>
            <polygon points="1.5 9.6063 24.01464 17.85582 46.5 9.6063 24.01464 1.5 1.5 9.6063" ${baseAttributes}></polygon>
        </svg>
    `,
    SM: `
        <svg class="status-item-icon-svg" viewBox="0 0 48 48" aria-hidden="true">
            <rect x="12.93493" y="1.5" width="22.86986" height="15.0411" ${baseAttributes}></rect>
            <rect x="28.40753" y="31.4589" width="18.09247" height="15.0411" ${baseAttributes}></rect>
            <rect x="1.5" y="31.4589" width="18.83219" height="15.0411" ${baseAttributes}></rect>
            <polyline points="39.84247 31.4589 24.36986 16.5411 8.89726 31.4589" ${baseAttributes}></polyline>
        </svg>
    `,
    ANIM: `
        <svg class="status-item-icon-svg" viewBox="0 0 48 48.42397" aria-hidden="true">
            <line x1="12.75" y1="20.62539" x2="12.75" y2="46.91965" ${baseAttributes}></line>
            <line x1="24" y1="32.96377" x2="24" y2="46.92397" ${baseAttributes}></line>
            <line x1="46.5" y1="32.96377" x2="46.5" y2="46.92397" ${baseAttributes}></line>
            <line x1="1.5" y1="32.96377" x2="1.5" y2="46.92397" ${baseAttributes}></line>
            <line x1="35.25" y1="20.62971" x2="35.25" y2="46.92397" ${baseAttributes}></line>
            <polygon points="12.32741 1.5 24 16.93483 35.67259 1.5 12.32741 1.5" ${baseAttributes}></polygon>
        </svg>
    `,
    INST: `
        <svg class="status-item-icon-svg" viewBox="0 0 48 48.00004" aria-hidden="true">
            <polygon points="1.5 10.87726 24 20.4202 46.5 10.87726 24 1.5 1.5 10.87726" ${baseAttributes}></polygon>
            <polyline points="1.5 24.39597 24 33.9389 46.5 24.39597" ${baseAttributes}></polyline>
            <polyline points="1.5 36.95706 24 46.50004 46.5 36.95706" ${baseAttributes}></polyline>
        </svg>
    `,
};

export function getStatusIconMarkup(token) {
    return STATUS_ICON_MARKUP[token] || '';
}
