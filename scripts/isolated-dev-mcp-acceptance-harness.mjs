#!/usr/bin/env node
/**
 * Deterministic live acceptance harness for the *isolated* RAV DEV app.
 *
 * This client deliberately has no discovery mode: the caller must supply both
 * the DEV bundle's rav-mcp executable and port 9278.  It rejects port 9274,
 * /Applications paths, relative sidecar paths, and non-absolute fixture paths
 * before it starts a child process.  It therefore cannot attach to production
 * by accident.
 *
 * Usage:
 *   node scripts/isolated-dev-mcp-acceptance-harness.mjs \
 *     --sidecar /absolute/path/to/RAV\ 2.5.5\ DEV.app/Contents/MacOS/rav-mcp \
 *     --port 9278 \
 *     --expected-build b0217-20260827-0000-abcdef0 \
 *     --expected-version 2.5.5 \
 *     --expected-channel dev \
 *     --expected-sidecar-sha256 <64 lowercase hex characters> \
 *     --expected-scenario-sha256 <64 lowercase hex characters> \
 *     --scenario /absolute/path/to/isolated-dev-mcp-acceptance.json \
 *     --out /tmp/rav-isolated-acceptance.json
 *
 * Run this only against a running isolated DEV app configured to expose MCP on
 * 127.0.0.1:9278. Keep fixture paths and generated receipts outside the public
 * source tree.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import readline from 'node:readline';

const ISOLATED_PORT = 9278;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_POLL_MS = 100;
const DEFAULT_POLL_TIMEOUT_MS = 3_000;
const EXPECTED_TOOL_COUNT = 57;
const REQUIRED_RELEASE_TOOLS = [
    'rav_get_global_vm_tree', 'rav_global_vm_get', 'rav_global_vm_set',
    'rav_global_vm_fire', 'rav_global_vm_set_image', 'rav_global_vm_clear_image',
    'rav_capture_canvas',
    'rav_media_capabilities', 'rav_export_media', 'rav_record_start',
    'rav_record_stop', 'rav_media_status', 'rav_media_cancel',
    'rav_step_frames', 'rav_pointer',
];

class AssertionError extends Error {
    constructor(message, receipt = {}) {
        super(message);
        this.name = 'AssertionError';
        this.receipt = receipt;
    }
}

class McpToolError extends Error {
    constructor(name, result) {
        const text = result?.content?.find?.((entry) => entry?.type === 'text')?.text || 'Unknown MCP tool error';
        super(`${name}: ${text}`);
        this.name = 'McpToolError';
        this.tool = name;
        this.result = result;
    }
}

function usage() {
    return `Usage:\n  node scripts/isolated-dev-mcp-acceptance-harness.mjs --sidecar <absolute DEV rav-mcp path> --port 9278 --expected-build <exact build stamp> --expected-version <version> --expected-channel dev --expected-sidecar-sha256 <sha256> --expected-scenario-sha256 <sha256> --scenario <scenario.json> [--out <receipt.json>]\n\nSafety: only port 9278 is accepted; /Applications and production port 9274 are refused.`;
}

function parseArgs(argv) {
    const options = {};
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (token === '--help' || token === '-h') return { help: true };
        if (!token.startsWith('--')) throw new Error(`Unexpected argument "${token}".\n${usage()}`);
        const key = token.slice(2);
        const value = argv[index + 1];
        if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}.\n${usage()}`);
        options[key] = value;
        index += 1;
    }
    return options;
}

function assertIsolatedOptions(options) {
    if (!options.sidecar || !options.port || !options.scenario
        || !options['expected-build'] || !options['expected-version'] || !options['expected-channel']
        || !options['expected-sidecar-sha256'] || !options['expected-scenario-sha256']) {
        throw new Error(usage());
    }
    if (String(options.port) !== String(ISOLATED_PORT)) {
        throw new Error(`Refusing port ${options.port}. This harness only accepts isolated DEV port ${ISOLATED_PORT}.`);
    }
    if (!isAbsolute(options.sidecar)) throw new Error('Refusing a relative sidecar path. Supply the isolated DEV sidecar path explicitly.');
    if (options.sidecar.includes('/Applications/')) throw new Error('Refusing a sidecar inside /Applications. Use the isolated DEV bundle only.');
    if (!/^b\d+-\d{8}-\d{4}-[0-9a-z]+(?:-dirty)?$/i.test(options['expected-build'])) {
        throw new Error('expected-build must be the exact packaged RAV DEV build stamp.');
    }
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(options['expected-version'])) {
        throw new Error('expected-version must be a semantic version.');
    }
    if (options['expected-channel'] !== 'dev') {
        throw new Error('Refusing a non-DEV expected channel.');
    }
    if (!/^[0-9a-f]{64}$/.test(options['expected-sidecar-sha256'])) {
        throw new Error('expected-sidecar-sha256 must be an exact lowercase SHA-256 digest.');
    }
    if (!/^[0-9a-f]{64}$/.test(options['expected-scenario-sha256'])) {
        throw new Error('expected-scenario-sha256 must be an exact lowercase SHA-256 digest.');
    }
    if (!isAbsolute(options.scenario)) options.scenario = resolve(options.scenario);
    if (options.out && !isAbsolute(options.out)) options.out = resolve(options.out);
}

function now() {
    return new Date().toISOString();
}

function sleep(milliseconds) {
    return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

function elapsed(startedAt) {
    return Math.round(performance.now() - startedAt);
}

function compactStatus(status) {
    return {
        app: {
            build: status?.app?.build || null,
            channel: status?.app?.channel || null,
            version: status?.app?.version || null,
        },
        file: { name: status?.file?.name || null, loaded: Boolean(status?.file?.loaded) },
        playback: {
            isPlaying: Boolean(status?.playback?.isPlaying),
            isPaused: Boolean(status?.playback?.isPaused),
            name: status?.playback?.name || null,
            type: status?.playback?.type || null,
        },
        renderSurface: {
            health: status?.renderSurface?.health || null,
            active: Boolean(status?.renderSurface?.active),
            isLoaded: Boolean(status?.renderSurface?.isLoaded),
            sessionId: status?.renderSurface?.sessionId || status?.renderSurface?.activeSessionId || null,
        },
        vmHasRoot: Boolean(status?.viewModel?.hasRoot),
        vmInstanceKeyPresent: Boolean(status?.viewModel
            && Object.prototype.hasOwnProperty.call(status.viewModel, 'instanceKey')),
        vmPathCount: Number(status?.viewModel?.pathCount || 0),
        vmInstanceKey: status?.viewModel?.instanceKey ?? null,
        artboard: status?.artboard?.currentArtboard || null,
    };
}

function normalizeColor(value) {
    if (!Number.isInteger(value) || value < -(2 ** 31) || value > 2 ** 32 - 1) {
        throw new AssertionError(`Invalid color value ${JSON.stringify(value)} returned by MCP.`);
    }
    return value < 0 ? value + 2 ** 32 : value;
}

function normalizedPaths(paths) {
    return (Array.isArray(paths) ? paths : []).map(String).sort();
}

function samePathMultiset(left, right) {
    const normalizedLeft = normalizedPaths(left);
    const normalizedRight = normalizedPaths(right);
    return normalizedLeft.length === normalizedRight.length
        && normalizedLeft.every((path, index) => path === normalizedRight[index]);
}

function sha256(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
}

function assertTimelineMetrics(playback, label) {
    const metrics = {
        currentFrame: Number(playback?.currentFrame),
        currentSeconds: Number(playback?.currentSeconds),
        fps: Number(playback?.fps),
        totalFrames: Number(playback?.totalFrames),
        totalSeconds: Number(playback?.totalSeconds),
    };
    assertion(playback?.type === 'animation', `${label}: expected animation playback.`, { playback });
    assertion(Number.isFinite(metrics.fps) && metrics.fps > 0,
        `${label}: FPS must be finite and positive.`, { playback });
    assertion(Number.isFinite(metrics.currentFrame) && metrics.currentFrame >= 0,
        `${label}: currentFrame must be finite and non-negative.`, { playback });
    assertion(Number.isFinite(metrics.totalFrames) && metrics.totalFrames > 0,
        `${label}: totalFrames must be finite and positive.`, { playback });
    assertion(Number.isFinite(metrics.currentSeconds) && metrics.currentSeconds >= 0,
        `${label}: currentSeconds must be finite and non-negative.`, { playback });
    assertion(Number.isFinite(metrics.totalSeconds) && metrics.totalSeconds > 0,
        `${label}: totalSeconds must be finite and positive.`, { playback });
    assertion(metrics.currentFrame <= metrics.totalFrames,
        `${label}: currentFrame exceeds totalFrames.`, { playback });
    assertion(metrics.currentSeconds <= metrics.totalSeconds + (1 / metrics.fps),
        `${label}: currentSeconds exceeds totalSeconds.`, { playback });
    assertion(Math.abs(metrics.currentFrame - Math.round(metrics.currentSeconds * metrics.fps)) <= 1,
        `${label}: frame and seconds clocks disagree at the reported FPS.`, { playback });
    assertion(Math.abs(metrics.totalFrames - Math.round(metrics.totalSeconds * metrics.fps)) <= 1,
        `${label}: total frames and seconds disagree at the reported FPS.`, { playback });
    if (playback?.durationSeconds !== undefined) {
        assertion(Number.isFinite(Number(playback.durationSeconds))
            && Math.abs(Number(playback.durationSeconds) - metrics.totalSeconds) <= Number.EPSILON,
        `${label}: durationSeconds and totalSeconds disagree.`, { playback });
    }
    return metrics;
}

function payloadOf(result) {
    if (result?.structuredContent && typeof result.structuredContent === 'object') return result.structuredContent;
    const text = result?.content?.find?.((entry) => entry?.type === 'text')?.text;
    if (typeof text === 'string') {
        try { return JSON.parse(text); } catch { return { text }; }
    }
    return result;
}

function assertion(condition, message, receipt) {
    if (!condition) throw new AssertionError(message, receipt);
}

function isSupportedError(error) {
    return error instanceof McpToolError
        && /not available|no .* available|not found|unsupported/i.test(error.message);
}

async function loadScenario(path) {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    assertion(parsed && typeof parsed === 'object', 'Scenario must be a JSON object.');
    assertion(parsed.files && typeof parsed.files === 'object', 'Scenario requires a "files" object.');
    for (const [alias, fixturePath] of Object.entries(parsed.files)) {
        assertion(typeof fixturePath === 'string' && isAbsolute(fixturePath), `Fixture "${alias}" must use an absolute path.`);
    }
    const sequence = parsed.openSequence || ['a', 'b', 'a'];
    assertion(Array.isArray(sequence) && sequence.length >= 3, 'openSequence must contain at least A/B/A entries.');
    assertion(sequence[0] === sequence.at(-1) && new Set(sequence).size >= 2,
        'openSequence must be an A/B/A-style sequence: first and last aliases match and at least two files are used.');
    for (const alias of sequence) assertion(parsed.files[alias], `openSequence references unknown fixture "${alias}".`);
    parsed.openSequence = sequence;
    return parsed;
}

function createMcpClient(sidecar, port, timeoutMs) {
    const child = spawn(sidecar, ['--stdio-only', '--port', String(port)], {
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    const pending = new Map();
    const stderr = [];
    let nextId = 1;
    let processError = null;

    child.on('error', (error) => { processError = error; });
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
        let message;
        try { message = JSON.parse(line); } catch (error) {
            processError = new Error(`Invalid MCP JSON: ${error.message}`);
            return;
        }
        const resolver = pending.get(message.id);
        if (!resolver) return;
        pending.delete(message.id);
        resolver.resolve(message);
    });
    readline.createInterface({ input: child.stderr }).on('line', (line) => stderr.push(line));

    function request(method, params = {}) {
        if (processError) return Promise.reject(processError);
        const id = nextId++;
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
        return new Promise((resolveRequest, rejectRequest) => {
            const timer = setTimeout(() => {
                pending.delete(id);
                rejectRequest(new Error(`Timed out after ${timeoutMs}ms waiting for ${method}.`));
            }, timeoutMs);
            pending.set(id, { resolve(value) { clearTimeout(timer); resolveRequest(value); } });
        });
    }

    return {
        stderr,
        async initialize() {
            const response = await request('initialize', {
                protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'rav-isolated-live-acceptance', version: '1' },
            });
            if (response.error) throw new Error(`MCP initialize failed: ${response.error.message}`);
            child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
        },
        async rawTool(name, args = {}) {
            const response = await request('tools/call', { name, arguments: args });
            if (response.error) throw new Error(`${name}: ${response.error.message}`);
            if (response.result?.isError) throw new McpToolError(name, response.result);
            return response.result;
        },
        async tool(name, args = {}) {
            return payloadOf(await this.rawTool(name, args));
        },
        async listTools() {
            const response = await request('tools/list');
            if (response.error) throw new Error(`tools/list failed: ${response.error.message}`);
            return response.result;
        },
        close() {
            for (const { resolve } of pending.values()) resolve({ error: { message: 'client closed' } });
            pending.clear();
            child.stdin.end();
            child.kill();
        },
    };
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) { process.stdout.write(`${usage()}\n`); return; }
    assertIsolatedOptions(options);
    await access(options.sidecar);
    const actualSidecarSha256 = sha256(await readFile(options.sidecar));
    assertion(actualSidecarSha256 === options['expected-sidecar-sha256'],
        'Isolated DEV sidecar SHA-256 does not match the pinned digest.', {
            expected: options['expected-sidecar-sha256'],
            actual: actualSidecarSha256,
        });
    const actualScenarioSha256 = sha256(await readFile(options.scenario));
    assertion(actualScenarioSha256 === options['expected-scenario-sha256'],
        'Acceptance scenario SHA-256 does not match the pinned digest.', {
            expected: options['expected-scenario-sha256'],
            actual: actualScenarioSha256,
        });
    const scenario = await loadScenario(options.scenario);
    const timeoutMs = Number(scenario.timeoutMs || DEFAULT_TIMEOUT_MS);
    assertion(Number.isFinite(timeoutMs) && timeoutMs > 0, 'Scenario timeoutMs must be a positive number.');

    const receipt = {
        harness: 'rav-isolated-dev-mcp-acceptance',
        startedAt: now(),
        target: {
            port: ISOLATED_PORT,
            sidecar: options.sidecar,
            sidecarSha256: actualSidecarSha256,
            scenario: options.scenario,
            scenarioSha256: actualScenarioSha256,
            expectedApp: {
                build: options['expected-build'],
                channel: options['expected-channel'],
                version: options['expected-version'],
            },
        },
        assertions: [],
        skipped: [],
        failures: [],
        passed: false,
    };
    const client = createMcpClient(options.sidecar, ISOLATED_PORT, timeoutMs);
    const status = async () => client.tool('rav_status');
    const fixturePath = (alias) => {
        const path = scenario.files[alias];
        assertion(path, `Unknown fixture alias "${alias}".`);
        return path;
    };
    const assertionNames = new Set();
    const addPass = (name, details = {}) => {
        assertion(!assertionNames.has(name), `Duplicate acceptance assertion name "${name}".`);
        assertionNames.add(name);
        receipt.assertions.push({ name, ok: true, ...details });
    };
    const addSkip = (name, reason) => receipt.skipped.push({ name, reason });

    async function waitForHealthyFile(alias, priorSessionId = null, sessionMode = 'new') {
        const startedAt = performance.now();
        const expectedName = fixturePath(alias).split('/').at(-1);
        let latest = null;
        while (elapsed(startedAt) <= Number(scenario.activationTimeoutMs || timeoutMs)) {
            latest = await status();
            const compact = compactStatus(latest);
            if (compact.file.loaded && compact.file.name === expectedName && compact.renderSurface.health === 'active'
                && compact.renderSurface.active && compact.renderSurface.isLoaded && compact.renderSurface.sessionId
                && (!priorSessionId || (sessionMode === 'same'
                    ? compact.renderSurface.sessionId === priorSessionId
                    : compact.renderSurface.sessionId !== priorSessionId))) {
                return { status: latest, compact, elapsedMs: elapsed(startedAt) };
            }
            await sleep(Number(scenario.pollMs || DEFAULT_POLL_MS));
        }
        const sessionExpectation = priorSessionId
            ? (sessionMode === 'same' ? 'the same' : 'a new')
            : 'an';
        throw new AssertionError(`Open ${alias} did not reach ${sessionExpectation} active, first-frame-ready surface.`, {
            expectedSessionId: sessionMode === 'same' ? priorSessionId : null,
            latest: compactStatus(latest),
        });
    }

    async function openAndAssert(alias, priorSessionId = null, label = `open ${alias}`) {
        const startedAt = performance.now();
        const opened = await client.tool('rav_open_file', { path: fixturePath(alias) });
        const health = await waitForHealthyFile(alias, priorSessionId);
        assertion(opened.ok === true, `${label}: rav_open_file did not acknowledge success.`, { opened });
        addPass(label, {
            elapsedMs: elapsed(startedAt), sessionId: health.compact.renderSurface.sessionId,
            file: health.compact.file.name, firstFrameHealthyAfterMs: health.elapsedMs,
        });
        return health.compact;
    }

    async function openFixtureForTest(config, testName) {
        if (!config?.file) return null;
        const before = compactStatus(await status()).renderSurface.sessionId;
        return openAndAssert(config.file, before, `${testName}: open ${config.file}`);
    }

    async function waitForPlayback(predicate, timeout = DEFAULT_POLL_TIMEOUT_MS) {
        const startedAt = performance.now();
        let latest = null;
        while (elapsed(startedAt) <= timeout) {
            latest = await status();
            if (predicate(latest?.playback || {})) return latest;
            await sleep(Number(scenario.pollMs || DEFAULT_POLL_MS));
        }
        throw new AssertionError('Playback state did not converge.', { latest: latest?.playback || null });
    }

    async function readVm(path) {
        return client.tool('rav_vm_get', { path });
    }

    async function waitForImagePresence(paths, expectedPresent, label) {
        const startedAt = performance.now();
        let latest = null;
        while (elapsed(startedAt) <= Number(scenario.activationTimeoutMs || timeoutMs)) {
            latest = await client.tool('rav_get_vm_tree');
            const inputs = Array.isArray(latest?.inputs) ? latest.inputs : [];
            const matched = paths.map((path) => inputs.find((candidate) => candidate.path === path));
            if (matched.every((input) => Boolean(input?.present) === expectedPresent)) {
                return { elapsedMs: elapsed(startedAt), inputs: matched };
            }
            await sleep(Number(scenario.pollMs || DEFAULT_POLL_MS));
        }
        throw new AssertionError(`${label}: image presence did not converge.`, {
            expectedPresent,
            paths,
            latest,
        });
    }

    async function setAndVerify(kind, config) {
        if (!config?.path) return addSkip(`vm ${kind}`, 'No fixture path provided in scenario.');
        await openFixtureForTest(config, `vm ${kind}`);
        const original = await readVm(config.path);
        const requested = config.value;
        assertion(requested !== undefined, `vm ${kind}: scenario requires value.`);
        try {
            const written = await client.tool('rav_vm_set', { path: config.path, value: requested });
            const readBack = await readVm(config.path);
            assertion(written.applied !== false, `vm ${kind}: write was rejected.`, { written });
            assertion(readBack.kind === kind, `vm ${kind}: expected ${kind}, got ${readBack.kind}.`, { readBack });
            assertion(readBack.value === requested, `vm ${kind}: read-back mismatch.`, { requested, readBack });
            addPass(`vm ${kind} two-way set/get`, { path: config.path, requested, readBack: readBack.value });
        } finally {
            await client.tool('rav_vm_set', { path: config.path, value: original.value });
        }
    }

    try {
        await client.initialize();
        const listed = await client.listTools();
        const listedTools = Array.isArray(listed?.tools) ? listed.tools : [];
        const listedNames = listedTools.map((tool) => tool?.name);
        assertion(listedTools.length === EXPECTED_TOOL_COUNT,
            `tools/list: expected exactly ${EXPECTED_TOOL_COUNT} tools, got ${listedTools.length}.`, { count: listedTools.length });
        assertion(listedNames.every((name) => typeof name === 'string' && name.length > 0),
            'tools/list: every advertised tool must have a non-empty name.', { listedNames });
        assertion(new Set(listedNames).size === listedNames.length,
            'tools/list: advertised tool names must be unique.', { listedNames });
        assertion(REQUIRED_RELEASE_TOOLS.every((name) => listedNames.includes(name)),
            'tools/list: required GVM, capture, and media tools are not all advertised.', {
                missing: REQUIRED_RELEASE_TOOLS.filter((name) => !listedNames.includes(name)),
            });
        addPass('tools/list: exact 57 unique tools including GVM/capture/media names', {
            count: listedTools.length,
            required: REQUIRED_RELEASE_TOOLS,
            names: listedNames,
        });
        const before = compactStatus(await status());
        const expectedApp = receipt.target.expectedApp;
        assertion(before.app.build === expectedApp.build
            && before.app.channel === expectedApp.channel
            && before.app.version === expectedApp.version,
        'MCP responded from a different or unidentified RAV build.', { expectedApp, actualApp: before.app });
        addPass('MCP connected to the exact isolated DEV build', { initial: before });

        let priorSessionId = before.renderSurface.sessionId;
        for (let repetition = 0; repetition < Number(scenario.openRepeats || 1); repetition += 1) {
            for (const [stepIndex, alias] of scenario.openSequence.entries()) {
                const after = await openAndAssert(alias, priorSessionId,
                    `open sequence ${repetition + 1}/${scenario.openRepeats || 1} step ${stepIndex + 1}/${scenario.openSequence.length}: ${alias}`);
                priorSessionId = after.renderSurface.sessionId;
            }
        }

        if (scenario.authoredInstanceTransition?.file) {
            const config = scenario.authoredInstanceTransition;
            let current = await openFixtureForTest(config, 'authored instance transition');
            const transitions = [];
            for (const instance of config.instances || []) {
                const switched = await client.tool('rav_switch_vm_instance', { instance });
                const next = compactStatus(await status());
                assertion(switched.applied === true, `authored instance ${instance}: switch rejected.`, { switched, next });
                assertion(switched.instanceKey === String(instance) && next.vmInstanceKey === String(instance),
                    `authored instance ${instance}: canonical instance key mismatch.`, { switched, next });
                assertion(next.renderSurface.health === 'active' && next.renderSurface.active
                    && next.renderSurface.isLoaded && next.file.loaded,
                `authored instance ${instance}: switched surface is not active and healthy.`, { next });
                assertion(next.renderSurface.sessionId && next.renderSurface.sessionId !== current.renderSurface.sessionId,
                    `authored instance ${instance}: no fresh authoritative surface.`, { current, next });
                transitions.push({
                    instance,
                    instanceKey: next.vmInstanceKey,
                    sessionId: next.renderSurface.sessionId,
                    vmPathCount: next.vmPathCount,
                });
                current = next;
            }
            const target = config.thenOpen;
            if (target) {
                const next = await openAndAssert(target, current.renderSurface.sessionId, `authored instances -> open ${target}`);
                transitions.push({ file: next.file.name, sessionId: next.renderSurface.sessionId, vmPathCount: next.vmPathCount });
            }
            addPass('authored instance sequence followed by unrelated fixture', { transitions });
        }

        if (scenario.instanceModes?.file) {
            const config = scenario.instanceModes;
            let current = await openFixtureForTest(config, 'instance modes');
            const transitions = [];
            for (const instance of config.instances || []) {
                const switched = await client.tool('rav_switch_vm_instance', { instance });
                const next = compactStatus(await status());
                const expectedKey = instance === 'auto' ? null : String(instance);
                assertion(switched.applied === true,
                    `instance mode ${String(instance)}: switch rejected.`, { switched, next });
                assertion(Object.prototype.hasOwnProperty.call(switched, 'instanceKey')
                    && switched.instanceKey === expectedKey
                    && next.vmInstanceKeyPresent
                    && next.vmInstanceKey === expectedKey,
                    `instance mode ${String(instance)}: canonical instance key mismatch.`, {
                        expectedKey,
                        switched,
                        next,
                    });
                assertion(next.vmHasRoot && next.vmPathCount > 0,
                    `instance mode ${String(instance)}: no bound canonical ViewModel topology.`, { next });
                assertion(next.renderSurface.health === 'active' && next.renderSurface.active
                    && next.renderSurface.isLoaded && next.file.loaded,
                `instance mode ${String(instance)}: switched surface is not active and healthy.`, { next });
                assertion(next.renderSurface.sessionId
                    && next.renderSurface.sessionId !== current.renderSurface.sessionId,
                `instance mode ${String(instance)}: no fresh authoritative surface.`, { current, next });
                transitions.push({
                    instance,
                    instanceKey: next.vmInstanceKey,
                    sessionId: next.renderSurface.sessionId,
                    vmPathCount: next.vmPathCount,
                });
                current = next;
            }
            addPass('numeric and automatic VM instance transitions', { transitions });
        }

        if (scenario.timeline?.file) {
            const config = scenario.timeline;
            await openFixtureForTest(config, 'timeline');
            if (config.artboard || config.playback) {
                const switched = await client.tool('rav_switch_artboard', {
                    artboard: config.artboard,
                    ...(config.playback ? { playback: config.playback } : {}),
                });
                assertion(switched.applied === true, 'timeline: playback switch rejected.', { switched, config });
            }
            const first = await waitForPlayback((playback) => playback.type === 'animation'
                && Number.isFinite(playback.currentFrame) && Number(playback.totalFrames) > 0
                && Number.isFinite(playback.currentSeconds) && Number(playback.totalSeconds) > 0
                && Number(playback.fps) > 0);
            const firstMetrics = assertTimelineMetrics(first.playback, 'timeline initial sample');
            await sleep(Number(config.sampleMs || 250));
            // A freshly activated packaged WebView can need more than one
            // renderer turn before its first advancing timeline snapshot
            // reaches the host. Poll for a real clock delta while keeping the
            // assertion fail-closed instead of treating one 250ms sample as
            // proof that the animation is stalled.
            const running = await waitForPlayback((playback) => playback.type === 'animation'
                && Number(playback.currentFrame) > firstMetrics.currentFrame
                && Number(playback.currentSeconds) > firstMetrics.currentSeconds,
            Number(config.advanceTimeoutMs || DEFAULT_POLL_TIMEOUT_MS));
            const runningMetrics = assertTimelineMetrics(running.playback, 'timeline running sample');
            assertion(runningMetrics.currentFrame > firstMetrics.currentFrame,
                'timeline: frame clock did not advance.', { first: first.playback, running: running.playback });
            assertion(runningMetrics.currentSeconds > firstMetrics.currentSeconds,
                'timeline: seconds clock did not advance.', { first: first.playback, running: running.playback });
            await client.tool('rav_pause');
            const paused = await waitForPlayback((playback) => playback.type === 'animation' && playback.isPaused === true);
            const pausedMetrics = assertTimelineMetrics(paused.playback, 'timeline paused sample');
            await sleep(Number(config.sampleMs || 250));
            const held = await status();
            const heldMetrics = assertTimelineMetrics(held.playback, 'timeline held sample');
            assertion(heldMetrics.currentFrame === pausedMetrics.currentFrame,
                'timeline: paused frame did not hold.', { paused: paused.playback, held: held.playback });
            assertion(heldMetrics.currentSeconds === pausedMetrics.currentSeconds,
                'timeline: paused seconds did not hold.', { paused: paused.playback, held: held.playback });
            await client.tool('rav_reset');
            const reset = await waitForPlayback((playback) => playback.type === 'animation'
                && Number.isFinite(playback.currentFrame) && playback.currentFrame <= 2);
            const resetMetrics = assertTimelineMetrics(reset.playback, 'timeline reset sample');
            assertion(resetMetrics.currentSeconds <= (2 / resetMetrics.fps),
                'timeline: reset seconds did not return to the opening frame window.', { reset: reset.playback });
            addPass('timeline canonical frames/seconds, pause hold, and reset', {
                first: first.playback, running: running.playback, paused: paused.playback, reset: reset.playback,
            });
            if (config.stateMachinePlayback) {
                const switched = await client.tool('rav_switch_artboard', {
                    artboard: config.artboard,
                    playback: config.stateMachinePlayback,
                });
                assertion(switched.applied === true, 'timeline: state-machine switch rejected.', { switched, config });
                const machine = await waitForPlayback((playback) => playback.type === 'stateMachine');
                assertion(['currentFrame', 'currentSeconds', 'durationSeconds', 'fps', 'totalFrames', 'totalSeconds']
                    .every((key) => machine.playback[key] == null),
                    'state machine leaked timeline metrics.', { playback: machine.playback });
                addPass('state machine hides timeline metrics', { playback: machine.playback });
            }
        }

        if (scenario.stateMachineInputs?.file) {
            const config = scenario.stateMachineInputs;
            await openFixtureForTest(config, 'state-machine inputs');
            const before = await client.tool('rav_get_sm_inputs');
            const results = [];
            for (const [kind, target] of Object.entries(config)) {
                if (kind === 'file' || !target?.name) continue;
                const original = before.inputs?.find((input) => input.name === target.name);
                assertion(original, `state-machine ${kind}: input not found.`, { before, target });
                const written = await client.tool('rav_set_sm_input', { name: target.name, value: target.value });
                const after = await client.tool('rav_get_sm_inputs');
                const readBack = after.inputs?.find((input) => input.name === target.name);
                assertion(written.applied !== false, `state-machine ${kind}: command rejected.`, { written });
                if (kind !== 'trigger') {
                    assertion(readBack?.value === target.value,
                        `state-machine ${kind}: canonical read-back mismatch.`, { target, written, readBack });
                    await client.tool('rav_set_sm_input', { name: target.name, value: original.value });
                }
                results.push({ kind, name: target.name, requested: target.value, readBack: readBack?.value });
            }
            addPass('state-machine inputs round-trip through child ACK and canonical state', { results });
        }

        if (scenario.images?.file) {
            const config = scenario.images;
            const imageSurface = await openFixtureForTest(config, 'images');
            const paths = config.paths || [];
            assertion(paths.length >= 2, 'images: scenario requires at least two independent paths.');
            assertion(config.replayThroughFile && scenario.files[config.replayThroughFile]
                && config.replayThroughFile !== config.file,
            'images: replayThroughFile must reference a different fixture alias.');
            const results = [];
            for (const path of paths) {
                const beforeTree = await client.tool('rav_get_vm_tree');
                const siblingPresence = new Map(paths
                    .filter((candidate) => candidate !== path)
                    .map((candidate) => [
                        candidate,
                        beforeTree.inputs?.find((input) => input.path === candidate)?.present === true,
                    ]));
                const set = await client.tool('rav_vm_set_image', {
                    path, bytes: config.bytes, label: `acceptance-${path.split('/').at(-1)}.png`,
                });
                assertion(set.applied === true && set.present === true,
                    `image ${path}: set did not confirm presentation.`, { set });
                const tree = await client.tool('rav_get_vm_tree');
                const input = tree.inputs?.find((candidate) => candidate.path === path);
                assertion(input?.present === true, `image ${path}: canonical presence missing after set.`, { input });
                for (const [sibling, wasPresent] of siblingPresence) {
                    const siblingInput = tree.inputs?.find((candidate) => candidate.path === sibling);
                    const isPresent = siblingInput?.present === true;
                    assertion(isPresent === wasPresent,
                        `image ${path}: setting one slot changed untouched sibling ${sibling}.`, {
                            before: wasPresent,
                            after: isPresent,
                            siblingInput,
                        });
                }
                results.push({ path, set: true });
            }
            await waitForImagePresence(paths, true, 'images after independent set');

            const beforePlaybackReset = compactStatus(await status());
            await client.tool('rav_reset');
            const afterPlaybackReset = compactStatus(await status());
            assertion(afterPlaybackReset.renderSurface.sessionId === beforePlaybackReset.renderSurface.sessionId
                && afterPlaybackReset.renderSurface.health === 'active'
                && afterPlaybackReset.renderSurface.active && afterPlaybackReset.renderSurface.isLoaded,
            'images: playback reset replaced or invalidated the authoritative surface.', {
                beforePlaybackReset,
                afterPlaybackReset,
            });
            const playbackResetReplay = await waitForImagePresence(paths, true, 'images after playback reset');

            const defaultReset = await client.tool('rav_reset_artboard');
            assertion(defaultReset.applied !== false,
                'images: default reset command was rejected.', { defaultReset });
            const defaultResetSurface = await waitForHealthyFile(
                config.file,
                imageSurface.renderSurface.sessionId,
                'same',
            );
            const defaultResetReplay = await waitForImagePresence(paths, true, 'images after default reset');

            const awayOpened = await client.tool('rav_open_file', {
                path: fixturePath(config.replayThroughFile),
            });
            const awaySurface = await waitForHealthyFile(
                config.replayThroughFile,
                defaultResetSurface.compact.renderSurface.sessionId,
            );
            assertion(awayOpened.ok === true, 'images: A -> B replay transition did not open the alternate fixture.', {
                awayOpened,
            });
            const awayTree = await client.tool('rav_get_vm_tree');
            assertion(!paths.some((path) => awayTree.inputs?.some(
                (candidate) => candidate.path === path && candidate.present === true,
            )), 'images: image state leaked into the alternate fixture.', { awayTree, paths });

            const reopened = await client.tool('rav_open_file', { path: fixturePath(config.file) });
            const reopenedSurface = await waitForHealthyFile(
                config.file,
                awaySurface.compact.renderSurface.sessionId,
            );
            assertion(reopened.ok === true, 'images: A -> B -> A replay did not reopen the image fixture.', {
                reopened,
            });
            const sourceReplay = await waitForImagePresence(paths, true, 'images after A/B/A replay');
            addPass('independent image slots replay through playback reset, default reset, and A/B/A', {
                paths,
                sessions: {
                    original: imageSurface.renderSurface.sessionId,
                    playbackReset: afterPlaybackReset.renderSurface.sessionId,
                    defaultReset: defaultResetSurface.compact.renderSurface.sessionId,
                    away: awaySurface.compact.renderSurface.sessionId,
                    reopened: reopenedSurface.compact.renderSurface.sessionId,
                },
                replayElapsedMs: {
                    playbackReset: playbackResetReplay.elapsedMs,
                    defaultReset: defaultResetReplay.elapsedMs,
                    reopened: sourceReplay.elapsedMs,
                },
            });

            for (const [index, path] of paths.entries()) {
                const cleared = await client.tool('rav_vm_clear_image', { path });
                assertion(cleared.applied === true && cleared.present === false,
                    `image ${path}: clear did not confirm presentation.`, { cleared });
                await waitForImagePresence([path], false, `image ${path} after clear`);
                const remainingPaths = paths.slice(index + 1);
                if (remainingPaths.length) {
                    await waitForImagePresence(remainingPaths, true,
                        `image ${path}: untouched sibling after clear`);
                }
            }
            addPass('independent image slots set and clear through presented child ACK', { results });
        }

        const controls = scenario.controls || {};
        if (controls.color?.path) {
            const config = controls.color;
            await openFixtureForTest(config, 'vm color');
            const original = await readVm(config.path);
            const signedValue = config.signedValue;
            assertion(Number.isInteger(signedValue) && signedValue < 0,
                'vm color: signedValue must be a negative signed int32 to prove the signed-color boundary.');
            try {
                const written = await client.tool('rav_vm_set', { path: config.path, value: signedValue });
                const readBack = await readVm(config.path);
                assertion(written.applied !== false, 'vm color: signed write was rejected.', { written });
                assertion(normalizeColor(readBack.value) === normalizeColor(signedValue),
                    'vm color: signed round-trip value differs after uint32 normalization.', { signedValue, readBack });
                addPass('vm color signed two-way round-trip', { path: config.path, signedValue, readBack: readBack.value });
            } finally {
                await client.tool('rav_vm_set', { path: config.path, value: original.value });
            }
        } else addSkip('vm color signed two-way round-trip', 'No color fixture path provided in scenario.');

        for (const kind of ['boolean', 'number', 'enum']) await setAndVerify(kind, controls[kind]);

        const global = scenario.globalViewModel;
        assertion(global?.file && global?.name && global?.path,
            'global VM: scenario requires file, name, and path for tree/get/set/restore coverage.', { global });
        await openFixtureForTest(global, 'global VM');
        const globalTree = await client.tool('rav_get_global_vm_tree');
        const globalGroup = globalTree?.globalViewModels?.find?.((entry) => entry.name === global.name
            || entry.globalViewModelName === global.name);
        const globalInput = globalGroup?.inputs?.find?.((entry) => entry.path === global.path);
        assertion(globalGroup && globalInput,
            'global VM: tree did not expose the configured global ViewModel property.', {
                name: global.name, path: global.path, tree: globalTree,
            });
        const originalGlobal = await client.tool('rav_global_vm_get', { name: global.name, path: global.path });
        assertion(originalGlobal.name === global.name && originalGlobal.path === global.path,
            'global VM: get returned the wrong canonical identity.', { originalGlobal });
        assertion(global.value !== undefined, 'global VM: scenario requires a mutation value.', { global });
        try {
            const writtenGlobal = await client.tool('rav_global_vm_set', {
                name: global.name, path: global.path, value: global.value,
            });
            const changedGlobal = await client.tool('rav_global_vm_get', { name: global.name, path: global.path });
            assertion(writtenGlobal.applied !== false && changedGlobal.value === global.value,
                'global VM: set/get did not round-trip the requested value.', {
                    writtenGlobal, changedGlobal, requested: global.value,
                });
        } finally {
            await client.tool('rav_global_vm_set', {
                name: global.name, path: global.path, value: originalGlobal.value,
            });
        }
        const restoredGlobal = await client.tool('rav_global_vm_get', { name: global.name, path: global.path });
        assertion(restoredGlobal.value === originalGlobal.value,
            'global VM: restore did not return the original value.', { originalGlobal, restoredGlobal });
        addPass('global VM tree/get/set/restore', {
            globalViewModelName: global.name, path: global.path, kind: originalGlobal.kind,
            original: originalGlobal.value, requested: global.value, restored: restoredGlobal.value,
        });

        const captureRaw = await client.rawTool('rav_capture_canvas');
        const captureMetadata = captureRaw?.structuredContent?.metadata
            || payloadOf(captureRaw)?.metadata || {};
        const captureImage = captureRaw?.content?.find?.((entry) => entry?.type === 'image');
        assertion(captureImage?.mimeType === 'image/png' && typeof captureImage.data === 'string'
            && captureImage.data.length > 0,
        'capture: rav_capture_canvas did not return a non-empty PNG image.', { captureRaw });
        const captureBytes = Buffer.from(captureImage.data, 'base64');
        assertion(captureBytes.length >= 8
            && captureBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
        'capture: decoded image does not have a valid PNG signature.', { mimeType: captureImage.mimeType });
        assertion(Number.isInteger(captureMetadata.pngByteLength)
            && captureMetadata.pngByteLength === captureBytes.length,
        'capture: decoded PNG byte length does not match metadata.', {
            decodedByteLength: captureBytes.length, metadataByteLength: captureMetadata.pngByteLength,
        });
        addPass('capture: valid PNG byte length matches metadata', {
            mimeType: captureImage.mimeType, decodedByteLength: captureBytes.length,
            metadataByteLength: captureMetadata.pngByteLength,
        });

        if (scenario.listGrowth?.triggerPath && scenario.listGrowth?.newItemPath) {
            const config = scenario.listGrowth;
            const listSurface = await openFixtureForTest(config, 'list growth');
            const beforeTree = await client.tool('rav_get_vm_tree');
            const beforePaths = Array.isArray(beforeTree.paths) ? beforeTree.paths : [];
            assertion(!beforePaths.includes(config.newItemPath), 'list growth: new item path already exists before trigger.', { newItemPath: config.newItemPath });
            await client.tool('rav_vm_fire', { path: config.triggerPath });
            const startedAt = performance.now();
            let created = null;
            while (elapsed(startedAt) <= Number(config.timeoutMs || DEFAULT_POLL_TIMEOUT_MS)) {
                try { created = await readVm(config.newItemPath); break; } catch (error) {
                    if (!(error instanceof McpToolError)) throw error;
                    await sleep(Number(config.pollMs || DEFAULT_POLL_MS));
                }
            }
            assertion(created, 'list growth: trigger did not create the expected runtime list item.', { newItemPath: config.newItemPath });
            if (config.value !== undefined) {
                await client.tool('rav_vm_set', { path: config.newItemPath, value: config.value });
                const readBack = await readVm(config.newItemPath);
                assertion(readBack.value === config.value, 'list growth: generated list item did not accept/read back mutation.', { readBack });
            }
            const afterTree = await client.tool('rav_get_vm_tree');
            const afterPaths = Array.isArray(afterTree.paths) ? afterTree.paths : [];
            assertion(afterPaths.includes(config.newItemPath), 'list growth: generated item missing from refreshed authoritative tree.', { afterPaths });
            addPass('runtime list growth and generated-item mutation', {
                triggerPath: config.triggerPath, newItemPath: config.newItemPath,
                pathCount: { before: beforePaths.length, after: afterPaths.length },
            });
            assertion(config.shrinkTriggerPath,
                'list shrink: scenario requires shrinkTriggerPath after runtime growth.');
            await client.tool('rav_vm_fire', { path: config.shrinkTriggerPath });
            const shrinkStartedAt = performance.now();
            let shrunkTree = null;
            while (elapsed(shrinkStartedAt) <= Number(config.timeoutMs || DEFAULT_POLL_TIMEOUT_MS)) {
                const candidate = await client.tool('rav_get_vm_tree');
                const candidatePaths = Array.isArray(candidate.paths) ? candidate.paths : [];
                if (!candidatePaths.includes(config.newItemPath) && samePathMultiset(candidatePaths, beforePaths)) {
                    shrunkTree = candidate;
                    break;
                }
                await sleep(Number(config.pollMs || DEFAULT_POLL_MS));
            }
            assertion(shrunkTree,
                'list shrink: topology did not return to its pre-growth shape.', {
                    beforePaths: normalizedPaths(beforePaths),
                    newItemPath: config.newItemPath,
                });
            let stalePathError = null;
            try {
                await readVm(config.newItemPath);
            } catch (error) {
                if (!(error instanceof McpToolError)) throw error;
                stalePathError = error;
            }
            assertion(stalePathError && /not found|not readable|out of bounds/i.test(stalePathError.message),
                'list shrink: removed runtime row did not return a specific stale-path error.', {
                    message: stalePathError?.message || null,
                    newItemPath: config.newItemPath,
                });
            const afterShrink = compactStatus(await status());
            assertion(afterShrink.renderSurface.health === 'active' && afterShrink.renderSurface.active
                && afterShrink.renderSurface.isLoaded && afterShrink.file.loaded
                && afterShrink.renderSurface.sessionId === listSurface.renderSurface.sessionId,
            'list shrink: authoritative render surface did not remain healthy and stable.', {
                before: listSurface,
                after: afterShrink,
            });
            addPass('runtime list shrink and stale-path rejection', {
                shrinkTriggerPath: config.shrinkTriggerPath,
                stalePath: config.newItemPath,
                pathCount: {
                    before: beforePaths.length,
                    afterGrowth: afterPaths.length,
                    afterShrink: Array.isArray(shrunkTree.paths) ? shrunkTree.paths.length : 0,
                },
                restoredPaths: normalizedPaths(shrunkTree.paths),
            });
        } else addSkip('runtime list growth and generated-item mutation', 'No listGrowth triggerPath/newItemPath provided in scenario.');

        const playback = scenario.playback;
        if (playback?.file) {
            await openFixtureForTest(playback, 'playback');
            for (const [name, expected] of [['rav_pause', 'paused'], ['rav_play', 'playing'], ['rav_reset', 'active'], ['rav_reset_artboard', 'active']]) {
                try {
                    const beforeCommand = compactStatus(await status());
                    await client.tool(name);
                    const current = compactStatus(await status());
                    if (expected === 'paused') assertion(current.playback.isPaused, `${name}: playback did not report paused.`, { current });
                    if (expected === 'playing') assertion(current.playback.isPlaying, `${name}: playback did not report playing.`, { current });
                    if (expected === 'active') assertion(current.renderSurface.health === 'active' && current.file.loaded,
                        `${name}: active surface was not retained.`, { current });
                    if (name === 'rav_reset') {
                        assertion(current.renderSurface.sessionId === beforeCommand.renderSurface.sessionId,
                            'rav_reset: playback reset replaced the authoritative render session.', {
                                before: beforeCommand,
                                current,
                            });
                    }
                    if (name === 'rav_reset_artboard') {
                        assertion(current.renderSurface.sessionId
                            && current.renderSurface.sessionId === beforeCommand.renderSurface.sessionId,
                        'rav_reset_artboard: default reset replaced the authoritative render session.', {
                            before: beforeCommand,
                            current,
                        });
                    }
                    addPass(`playback command ${name}`, { before: beforeCommand, status: current });
                } catch (error) {
                    if (isSupportedError(error) && playback.allowUnsupported !== false) addSkip(`playback command ${name}`, error.message);
                    else throw error;
                }
            }
        } else addSkip('playback/reset/default command sequence', 'No playback.file provided in scenario.');

        const presentation = scenario.presentation;
        if (presentation?.file) {
            await openFixtureForTest(presentation, 'presentation');
            const expected = {
                fit: presentation.fit || 'contain',
                alignment: presentation.alignment || 'center',
                color: presentation.color || '#123456',
                width: Number(presentation.width || 500),
                height: Number(presentation.height || 409),
                lockAspectRatio: presentation.lockAspectRatio !== false,
            };
            await client.tool('rav_set_canvas_size', {
                mode: 'fixed', width: expected.width, height: expected.height,
                lockAspectRatio: expected.lockAspectRatio,
            });
            await client.tool('rav_set_layout', { fit: expected.fit });
            await client.tool('rav_set_alignment', { alignment: expected.alignment });
            await client.tool('rav_set_canvas_color', { color: expected.color });
            for (const command of ['rav_play', 'rav_reset', 'rav_reset_artboard']) {
                await client.tool(command);
                const current = await status();
                assertion(current.layout?.fit === expected.fit, `${command}: fit diverged.`, { expected, current: current.layout });
                assertion(current.layout?.alignment === expected.alignment, `${command}: alignment diverged.`, { expected, current: current.layout });
                assertion(current.layout?.canvasColor?.toLowerCase() === expected.color.toLowerCase(), `${command}: canvas color diverged.`, { expected, current: current.layout });
                assertion(current.layout?.canvasSize?.mode === 'fixed'
                    && Number(current.layout?.canvasSize?.width) === expected.width
                    && Number(current.layout?.canvasSize?.height) === expected.height
                    && Boolean(current.layout?.canvasSize?.lockAspectRatio) === expected.lockAspectRatio,
                `${command}: fixed canvas size diverged.`, { expected, current: current.layout });
            }
            addPass('presentation controls persist through play/reset/default', expected);
            await client.tool('rav_set_canvas_size', { mode: 'auto' });
            await client.tool('rav_set_layout', { fit: 'contain' });
            await client.tool('rav_set_alignment', { alignment: 'center' });
        } else addSkip('presentation controls persist through play/reset/default', 'No presentation.file provided in scenario.');

        assertion(receipt.skipped.length === 0,
            'Acceptance is incomplete because one or more checks were skipped.', { skipped: receipt.skipped });
        assertion(assertionNames.size === receipt.assertions.length,
            'Acceptance contains duplicate assertion names.', {
                assertionNames: receipt.assertions.map((entry) => entry.name),
            });
        receipt.passed = true;
    } catch (error) {
        receipt.failures.push({
            name: error.name || 'Error', message: error.message,
            ...(error.receipt ? { details: error.receipt } : {}),
        });
    } finally {
        receipt.finishedAt = now();
        receipt.stderr = client.stderr.slice(-20);
        client.close();
    }

    const output = `${JSON.stringify(receipt, null, 2)}\n`;
    if (options.out) await writeFile(options.out, output, 'utf8');
    process.stdout.write(output);
    if (!receipt.passed) process.exitCode = 1;
}

await main();
