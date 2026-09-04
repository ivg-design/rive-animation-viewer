import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(path.resolve(process.cwd(), 'src-tauri/src/main.rs'), 'utf8');
const isolatedConfig = JSON.parse(readFileSync(
  path.resolve(process.cwd(), 'src-tauri/tauri.flicker-test.conf.json'),
  'utf8',
));

describe('native main-window startup contract', () => {
  it('presents and focuses the manually constructed create:false main window', () => {
    expect(mainSource).toMatch(/let main_window = main_window_builder\.build\(\)\?;/);
    expect(mainSource).toMatch(/main_window\.show\(\)\?;/);
    expect(mainSource).toMatch(/main_window\.set_focus\(\)\?;/);
  });

  it('gives the isolated bundle a unique process identity for native automation', () => {
    expect(isolatedConfig.identifier).toBe('app.rive.animation.viewer.flicker-test');
    expect(isolatedConfig.mainBinaryName).toBe('rav-2.5.5-dev');
  });
});
