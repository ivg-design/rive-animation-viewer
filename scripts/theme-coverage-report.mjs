import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const coverageBaseCssPath = path.resolve('coverage/base.css');
const darkThemeMarker = '/* codex coverage dark theme */';
const darkThemeCss = `

${darkThemeMarker}
:root {
    color-scheme: dark;
}

html,
body {
    background: #0b1120;
    color: #e5e7eb;
}

body,
.wrapper,
.pad1,
.pad2,
.pad2x,
.pad2y {
    background: #0b1120;
}

a {
    color: #93c5fd;
}

a:hover {
    color: #bfdbfe;
}

h1,
h2,
.strong,
div.path a:link,
div.path a:visited {
    color: #f8fafc;
}

.quiet,
.quiet a,
.ignore-none,
.coverage-summary td.empty {
    color: #94a3b8;
}

.fraction,
.missing-if-branch,
.skip-if-branch,
span.cline-neutral,
.cover-empty {
    background: #111827;
    color: #cbd5e1;
}

.missing-if-branch {
    border: 1px solid #334155;
    color: #fde68a;
}

.keyline-all,
.coverage-summary tr,
.coverage-summary tbody,
.coverage-summary td,
.coverage-summary th,
.high .chart,
.medium .chart,
.low .chart {
    border-color: #334155;
}

.coverage-summary th,
.coverage-summary td,
table.coverage td,
table.coverage td.line-count,
table.coverage td.line-coverage {
    color: #e5e7eb;
}

.low,
.cline-no {
    background: #3f0f1b;
    color: #fee2e2;
}

.cstat-no,
.fstat-no,
.highlighted,
.highlighted .cstat-no,
.highlighted .fstat-no,
.highlighted .cbranch-no {
    background: #7f1d1d !important;
    color: #fee2e2;
}

.cbranch-no {
    background: #b45309 !important;
    color: #fef3c7;
}

.medium {
    background: #3a2f0d;
    color: #fef3c7;
}

.status-line.medium,
.medium .cover-fill {
    background: #d97706;
}

.high,
.cline-yes {
    background: #0f2f24;
    color: #dcfce7;
}

.cstat-yes {
    background: #166534;
    color: #ecfdf5;
}

.status-line.high,
.high .cover-fill {
    background: #22c55e;
}

.red.solid,
.status-line.low,
.low .cover-fill {
    background: #ef4444;
}

.cstat-skip,
.fstat-skip,
.cbranch-skip {
    background: #1f2937 !important;
    color: #cbd5e1 !important;
}

pre.prettyprint,
pre,
table.coverage {
    background: #0f172a;
    color: #e5e7eb;
}

.pln {
    color: #e5e7eb;
}

.str,
.atv {
    color: #86efac;
}

.kwd,
.tag {
    color: #93c5fd;
}

.com {
    color: #94a3b8 !important;
}

.typ,
.dec,
.var,
.atn {
    color: #c4b5fd;
}

.lit {
    color: #67e8f9;
}

.fun {
    color: #fca5a5;
}

.pun,
.opn,
.clo {
    color: #cbd5e1;
}

li.L1,
li.L3,
li.L5,
li.L7,
li.L9 {
    background: #111827;
}
`;

if (!existsSync(coverageBaseCssPath)) {
    throw new Error(`Coverage stylesheet was not found: ${coverageBaseCssPath}`);
}

const currentContent = readFileSync(coverageBaseCssPath, 'utf8');
const nextContent = currentContent.includes(darkThemeMarker)
    ? currentContent.replace(new RegExp(`${darkThemeMarker}[\\s\\S]*$`), darkThemeCss.trimStart())
    : `${currentContent.trimEnd()}\n${darkThemeCss}`;

writeFileSync(coverageBaseCssPath, nextContent, 'utf8');

console.log(`Applied dark theme to coverage report: ${coverageBaseCssPath}`);
