#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

export const REQUIRED_ASSERTIONS = [
    'MCP connected to the exact isolated DEV build',
    'authored instance transition: open a',
    'authored instances -> open list',
    'authored instance sequence followed by unrelated fixture',
    'instance modes: open numericInstance',
    'numeric and automatic VM instance transitions',
    'timeline: open timeline',
    'timeline canonical frames/seconds, pause hold, and reset',
    'state machine hides timeline metrics',
    'state-machine inputs: open stateMachine',
    'state-machine inputs round-trip through child ACK and canonical state',
    'images: open b',
    'independent image slots replay through playback reset, default reset, and A/B/A',
    'independent image slots set and clear through presented child ACK',
    'vm color: open a',
    'vm color signed two-way round-trip',
    'vm boolean: open a',
    'vm boolean two-way set/get',
    'vm number: open a',
    'vm number two-way set/get',
    'vm enum: open a',
    'vm enum two-way set/get',
    'list growth: open list',
    'runtime list growth and generated-item mutation',
    'runtime list shrink and stale-path rejection',
    'playback: open a',
    'playback command rav_pause',
    'playback command rav_play',
    'playback command rav_reset',
    'playback command rav_reset_artboard',
    'presentation: open a',
    'presentation controls persist through play/reset/default',
];

function sha256(file) {
    return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function fail(message) {
    throw new Error(message);
}

function expectedOpenAssertions(scenario) {
    const sequence = scenario?.openSequence;
    const repetitions = Number(scenario?.openRepeats || 1);
    if (!Array.isArray(sequence) || sequence.length < 3 || !Number.isInteger(repetitions) || repetitions < 1) {
        fail('Pinned scenario must define a valid openSequence and openRepeats count.');
    }
    const names = [];
    for (let repetition = 0; repetition < repetitions; repetition += 1) {
        for (const [stepIndex, alias] of sequence.entries()) {
            names.push(`open sequence ${repetition + 1}/${repetitions} step ${stepIndex + 1}/${sequence.length}: ${alias}`);
        }
    }
    return names;
}

function validateClosureScenario(scenario) {
    const modes = scenario?.instanceModes;
    const zeroIndex = Array.isArray(modes?.instances) ? modes.instances.indexOf(0) : -1;
    if (modes?.file !== 'numericInstance'
        || zeroIndex < 0
        || modes.instances[zeroIndex + 1] !== 'auto') {
        fail('Pinned scenario must exercise numeric instance 0 immediately followed by automatic binding.');
    }
    if (!scenario?.listGrowth?.shrinkTriggerPath) {
        fail('Pinned scenario must exercise runtime list shrink after growth.');
    }
    const images = scenario?.images;
    if (!images?.file
        || !images?.replayThroughFile
        || images.replayThroughFile === images.file
        || !scenario?.files?.[images.file]
        || !scenario?.files?.[images.replayThroughFile]
        || !Array.isArray(images.paths)
        || images.paths.length < 2) {
        fail('Pinned scenario must exercise two independent image slots through reset and A/B/A replay.');
    }
}

function validateOptions(options = {}) {
    const {
        expectedBuild,
        expectedVersion,
        expectedChannel,
        sidecarPath,
        scenarioPath,
        expectedSidecarSha256,
        expectedScenarioSha256,
    } = options;
    if (!/^b\d+-\d{8}-\d{4}-[0-9a-z]+(?:-dirty)?$/i.test(expectedBuild || '')) {
        fail('expectedBuild must be the exact packaged DEV build stamp.');
    }
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(expectedVersion || '')) {
        fail('expectedVersion must be a semantic version.');
    }
    if (expectedChannel !== 'dev') fail('Only the DEV channel can satisfy isolated acceptance.');
    if (!isAbsolute(sidecarPath || '') || sidecarPath.includes('/Applications/')) {
        fail('sidecarPath must identify an isolated DEV bundle outside /Applications.');
    }
    if (!isAbsolute(scenarioPath || '')) fail('scenarioPath must be absolute.');
    if (!/^[0-9a-f]{64}$/.test(expectedSidecarSha256 || '')) {
        fail('expectedSidecarSha256 must be an exact lowercase SHA-256 digest.');
    }
    if (!/^[0-9a-f]{64}$/.test(expectedScenarioSha256 || '')) {
        fail('expectedScenarioSha256 must be an exact lowercase SHA-256 digest.');
    }
}

export function verifyReceipt(receipt, options = {}) {
    validateOptions(options);
    const {
        expectedBuild,
        expectedVersion,
        expectedChannel,
        sidecarPath,
        scenarioPath,
        expectedSidecarSha256,
        expectedScenarioSha256,
    } = options;
    if (!receipt || receipt.harness !== 'rav-isolated-dev-mcp-acceptance') {
        fail('Unexpected or missing acceptance harness.');
    }
    const target = receipt.target || {};
    const expectedApp = target.expectedApp || {};
    if (Number(target.port) !== 9278) fail('Receipt must target isolated DEV MCP port 9278.');
    if (target.sidecar !== sidecarPath) fail('Receipt sidecar path does not match the pinned DEV sidecar.');
    if (target.scenario !== scenarioPath) fail('Receipt scenario path does not match the pinned scenario.');
    if (expectedApp.build !== expectedBuild
        || expectedApp.version !== expectedVersion
        || expectedApp.channel !== expectedChannel) {
        fail('Receipt app identity does not match the pinned DEV build.');
    }
    const actualSidecarSha256 = sha256(sidecarPath);
    const actualScenarioSha256 = sha256(scenarioPath);
    if (actualSidecarSha256 !== expectedSidecarSha256
        || target.sidecarSha256 !== expectedSidecarSha256) {
        fail('Sidecar SHA-256 does not match the pinned digest and receipt.');
    }
    if (actualScenarioSha256 !== expectedScenarioSha256
        || target.scenarioSha256 !== expectedScenarioSha256) {
        fail('Scenario SHA-256 does not match the pinned digest and receipt.');
    }
    if (receipt.passed !== true) fail('Receipt must have passed: true.');
    if (!Array.isArray(receipt.failures) || receipt.failures.length !== 0) fail('Receipt contains failures.');
    if (!Array.isArray(receipt.skipped) || receipt.skipped.length !== 0) fail('Receipt contains skipped assertions.');
    if (!Array.isArray(receipt.assertions) || receipt.assertions.length === 0) {
        fail('Receipt assertions must be a non-empty array.');
    }
    if (receipt.assertions.some((entry) => entry?.ok !== true || typeof entry?.name !== 'string')) {
        fail('Every assertion must have a unique name and ok: true.');
    }
    const names = receipt.assertions.map((entry) => entry.name);
    if (new Set(names).size !== names.length) fail('Receipt contains duplicate assertion names.');

    const scenario = JSON.parse(readFileSync(scenarioPath, 'utf8'));
    validateClosureScenario(scenario);
    const required = [...expectedOpenAssertions(scenario), ...REQUIRED_ASSERTIONS];
    const missing = required.filter((name) => !names.includes(name));
    const unexpected = names.filter((name) => !required.includes(name));
    if (missing.length) fail(`Receipt is missing required assertions: ${missing.join(', ')}`);
    if (unexpected.length) fail(`Receipt contains unexpected assertions: ${unexpected.join(', ')}`);
    if (names.length !== required.length) fail('Receipt assertion inventory is incomplete.');

    return {
        assertions: names.length,
        build: expectedBuild,
        version: expectedVersion,
    };
}

function usage() {
    return 'Usage: node scripts/verify-isolated-dev-mcp-receipt.mjs --receipt <path> --expected-build <stamp> --expected-version <version> --expected-channel dev --sidecar <absolute path> --expected-sidecar-sha256 <sha256> --scenario <absolute path> --expected-scenario-sha256 <sha256>';
}

function parseArgs(argv) {
    const out = {};
    if (argv.includes('--help') || argv.includes('-h')) return { help: true };
    for (let index = 0; index < argv.length; index += 2) {
        const key = argv[index];
        const value = argv[index + 1];
        if (!key?.startsWith('--') || !value || value.startsWith('--')) fail(usage());
        out[key.slice(2)] = value;
    }
    return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        process.stdout.write(`${usage()}\n`);
        process.exit(0);
    }
    if (!args.receipt) fail(usage());
    const receiptPath = resolve(args.receipt);
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    const result = verifyReceipt(receipt, {
        expectedBuild: args['expected-build'],
        expectedVersion: args['expected-version'],
        expectedChannel: args['expected-channel'],
        sidecarPath: args.sidecar,
        scenarioPath: args.scenario,
        expectedSidecarSha256: args['expected-sidecar-sha256'],
        expectedScenarioSha256: args['expected-scenario-sha256'],
    });
    process.stdout.write(`Isolated DEV MCP receipt verified for ${result.build}: ${receiptPath}\n`);
}
