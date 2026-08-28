import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());

function read(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('native file-dialog safety', () => {
    it('keeps Tauri file pickers asynchronous and single-flight', () => {
        const controls = read('src-tauri/src/app/window/controls.rs');
        const demoBundle = read('src-tauri/src/app/demo_bundle.rs');
        const state = read('src-tauri/src/app/state.rs');

        for (const source of [controls, demoBundle]) {
            expect(source).not.toMatch(/(?:^|[^A-Za-z])FileDialog::new/);
            expect(source).toContain('AsyncFileDialog::new()');
            expect(source).toContain('try_acquire()?');
        }
        expect(controls).toMatch(/pub async fn pick_riv_file\(\s*window: Window,/);
        expect(controls).toMatch(/pub async fn pick_image_file\(\s*window: Window,/);
        expect(demoBundle).toMatch(/pub async fn make_demo_bundle\([\s\S]*?window: Window,/);
        expect(demoBundle).not.toContain('WebviewWindow');
        expect(state).toContain('pub struct NativeDialogState');
        expect(state).toContain('compare_exchange(false, true');
    });
});
