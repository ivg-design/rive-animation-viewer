import { readFileSync } from 'node:fs';
import path from 'node:path';

const css = readFileSync(path.resolve(process.cwd(), 'styles/09-script-console.css'), 'utf8');

describe('script console dark semantic palette', () => {
    it('keeps Eruda\'s virtual-list measurement layer rendered but invisible', () => {
        const fakeLogsRule = css.match(
            /\.script-console-output \.luna-console-fake-logs\s*\{([\s\S]*?)\}/,
        )?.[1] || '';

        expect(fakeLogsRule).toMatch(/display:\s*block\s*!important;/);
        expect(fakeLogsRule).toMatch(/position:\s*absolute\s*!important;/);
        expect(fakeLogsRule).toMatch(/visibility:\s*hidden\s*!important;/);
        expect(fakeLogsRule).not.toMatch(/^\s*display:\s*none/m);
    });

    it('overrides vendor light semantic row fills, text, and borders', () => {
        expect(css).toMatch(
            /\.script-console-output \.luna-console-log-item\.luna-console-info\s*\{[\s\S]*?color:\s*#c8d3e6\s*!important;[\s\S]*?background:\s*#111827\s*!important;[\s\S]*?border-bottom-color:\s*#263249\s*!important;/,
        );
        expect(css).toMatch(
            /\.script-console-output \.luna-console-log-item\.luna-console-warn\s*\{[\s\S]*?color:\s*#ffd166\s*!important;[\s\S]*?background:\s*#2a210f\s*!important;[\s\S]*?border-bottom-color:\s*#7a5a124d\s*!important;/,
        );
        expect(css).toMatch(
            /\.script-console-output \.luna-console-log-item\.luna-console-error\s*\{[\s\S]*?color:\s*#ff9aa6\s*!important;[\s\S]*?background:\s*#2b1218\s*!important;[\s\S]*?border-bottom-color:\s*#7a26344d\s*!important;/,
        );
        expect(css).not.toContain('#fffbe5');
        expect(css).not.toContain('#fff0f0');
    });

    it('keeps Eruda-selected plain log rows dark and restores their borders', () => {
        expect(css).toMatch(
            /\.script-console-output \.luna-console-log-container\.luna-console-selected \.luna-console-log-item:not\(\.luna-console-warn\):not\(\.luna-console-error\)\s*\{[\s\S]*?background:\s*#1d2634\s*!important;[\s\S]*?border-top-color:\s*#34435c\s*!important;[\s\S]*?border-bottom-color:\s*#34435c\s*!important;/,
        );
        expect(css).not.toMatch(/background:\s*#ecf1f8/i);
    });

    it('keeps semantic content and links readable on dark rows', () => {
        expect(css).toMatch(
            /\.script-console-output \.luna-console-log-item:is\(\.luna-console-info, \.luna-console-warn, \.luna-console-error\) \.luna-console-log-content\s*\{[\s\S]*?color:\s*inherit\s*!important;[\s\S]*?background:\s*transparent\s*!important;/,
        );
        expect(css).toMatch(
            /\.script-console-output \.luna-console-log-item a\s*\{[\s\S]*?color:\s*#9fb7ff\s*!important;[\s\S]*?text-decoration-color:\s*#9fb7ff99;/,
        );
        expect(css).toMatch(
            /\.script-console-output \.luna-console-log-item a:hover,[\s\S]*?\.script-console-output \.luna-console-log-item a:focus-visible\s*\{[\s\S]*?color:\s*var\(--neon\)\s*!important;/,
        );
    });
});
