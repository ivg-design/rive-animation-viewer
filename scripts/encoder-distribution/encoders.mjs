#!/usr/bin/env node
import {
    acquireDistribution,
    loadReleaseCatalog,
    resolveReleaseTarget,
    stageDistribution,
    verifyBundle,
    verifyStagedDirectory,
} from './lib.mjs';

const usage = `Usage:
  encoders.mjs acquire --target TARGET --work-dir DIR --cache-dir DIR --output DIR [--mac-signing-identity ID]
  encoders.mjs stage --target TARGET --inventory FILE --source-dir DIR --output DIR
  encoders.mjs verify --target TARGET --directory DIR
  encoders.mjs verify-bundle --target TARGET --app FILE.app

TARGET may be omitted when RAV_ENCODER_TARGET is set or for a native-host operation.`;

const parseOptions = (args) => {
    const options = {};
    for (let index = 0; index < args.length; index += 2) {
        const flag = args[index];
        const value = args[index + 1];
        if (!flag?.startsWith('--') || value === undefined || value.startsWith('--')) {
            throw new Error(`Invalid option sequence near ${flag || '<end>'}`);
        }
        const key = flag.slice(2);
        if (key in options) throw new Error(`Duplicate option: ${flag}`);
        options[key] = value;
    }
    return options;
};

const validateOptions = (options, required, optional = []) => {
    const allowed = new Set([...required, ...optional]);
    const unexpected = Object.keys(options).filter((key) => !allowed.has(key));
    const missing = required.filter((key) => !(key in options));
    if (unexpected.length || missing.length) {
        throw new Error(
            `Required options: ${required.map((key) => `--${key}`).join(', ')}; `
            + `optional: ${optional.map((key) => `--${key}`).join(', ') || '<none>'}`,
        );
    }
};

const resolvedTarget = async (requested) => {
    const catalog = await loadReleaseCatalog();
    return resolveReleaseTarget(catalog, requested).distribution_target;
};

const main = async () => {
    const [command, ...args] = process.argv.slice(2);
    const options = parseOptions(args);
    if (command === 'acquire') {
        validateOptions(options, ['work-dir', 'cache-dir', 'output'], ['target', 'mac-signing-identity']);
        return acquireDistribution({
            target: options.target,
            workDirectory: options['work-dir'],
            cacheDirectory: options['cache-dir'],
            outputDirectory: options.output,
            macSigningIdentity: options['mac-signing-identity'],
        });
    }
    if (command === 'stage') {
        validateOptions(options, ['inventory', 'source-dir', 'output'], ['target']);
        return stageDistribution({
            inventoryFile: options.inventory,
            sourceDirectory: options['source-dir'],
            outputDirectory: options.output,
            expectedTarget: await resolvedTarget(options.target),
        });
    }
    if (command === 'verify') {
        validateOptions(options, ['directory'], ['target']);
        return verifyStagedDirectory(options.directory, {
            expectedTarget: await resolvedTarget(options.target),
        });
    }
    if (command === 'verify-bundle') {
        validateOptions(options, ['app'], ['target']);
        return verifyBundle(options.app, {
            expectedTarget: await resolvedTarget(options.target),
        });
    }
    throw new Error(usage);
};

try {
    console.log(JSON.stringify(await main(), null, 2));
} catch (error) {
    console.error(`Encoder distribution gate failed: ${error.message}\n${usage}`);
    process.exitCode = 1;
}
