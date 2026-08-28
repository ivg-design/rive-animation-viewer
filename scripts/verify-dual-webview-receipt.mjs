import { readFileSync } from 'node:fs';
import path from 'node:path';

const requiredAssertions = [
    'childWebViewZOrder',
    'autoToFixedSmallCanvasCentering',
    'fixedCanvasUsesLogicalPixelsAtDpr',
    'fixedCanvasArtAlignment',
    'oversizedFixedCanvasTopLeftOrigin',
    'backgroundFitAlignmentAfterPlayback',
    'queuedControlsOnReload',
    'staticPausedFinishedActivation',
    'rapidSwitchingRejectsStaleResults',
    'toolbarResetKeepsRenderSession',
    'defaultResetKeepsRenderSession',
    'drawerAccess',
    'settingsMcpAboutExportOverlayAccess',
    'overlayPlaybackContinuity',
    'overlayOutsideClickAndToolbarToggle',
    'overlayChromeAndScrollbarStyling',
    'overlayFocusStyling',
    'invalidFixedDimensionValidation',
    'secondFileReload',
];

const args = process.argv.slice(2);
const receiptFlagIndex = args.indexOf('--receipt');
const receiptPath = receiptFlagIndex === -1
    ? '.github/dual-webview-gate-receipt.json'
    : args[receiptFlagIndex + 1];

if (!receiptPath || args.length > (receiptFlagIndex === -1 ? 0 : 2)) {
    throw new Error('Usage: node scripts/verify-dual-webview-receipt.mjs --receipt <path>');
}

let receipt;
try {
    receipt = JSON.parse(readFileSync(path.resolve(receiptPath), 'utf8'));
} catch (error) {
    throw new Error(`Cannot read dual-WebView receipt at ${receiptPath}: ${error.message}`);
}

const requiredFields = ['buildStamp', 'platform', 'fixture', 'validatedAt', 'validator'];
const missingFields = requiredFields.filter((field) => typeof receipt[field] !== 'string' || !receipt[field].trim());
if (missingFields.length > 0) {
    throw new Error(`Receipt is missing required non-empty fields: ${missingFields.join(', ')}`);
}

if (receipt.validationEnvironment !== 'actual-tauri-rav-mcp') {
    throw new Error('Receipt must declare validationEnvironment as actual-tauri-rav-mcp.');
}

if (receipt.automatedTests !== 'passed') {
    throw new Error('Receipt must record automatedTests as passed after npm run test:dual-webview.');
}

const missingAssertions = requiredAssertions.filter((name) => receipt.assertions?.[name] !== 'passed');
if (missingAssertions.length > 0) {
    throw new Error(`Receipt has incomplete or non-passing assertions: ${missingAssertions.join(', ')}`);
}

console.log(`Dual-WebView release receipt verified: ${receiptPath}`);
