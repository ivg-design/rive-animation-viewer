import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const installer = resolve('scripts/install-isolated-dev.sh');
const source = readFileSync(installer, 'utf8');

describe('isolated DEV installer safety contract', () => {
  it('pins the isolated identity and stable target while rejecting production', () => {
    expect(source).toContain('app.rive.animation.viewer.flicker-test');
    expect(source).toContain('${RAV_DEV_TARGET:-${HOME}/Desktop/RAV 2.5.3 DEV.app}');
    expect(source).toContain('/Applications/Rive Animation Viewer.app');
    expect(source).toContain('source bundle identifier');
    expect(source).toContain('source and stable target must be different paths');
  });

  it('validates before staging and refreshes only the exact stable target', () => {
    expect(source.indexOf('source bundle identifier')).toBeLessThan(source.indexOf('staging_dir='));
    expect(source).toContain('"$lsregister" -u "$stable_target"');
    expect(source).toContain('"$lsregister" -f "$stable_target"');
    expect(source).not.toContain('lsregister" -u /Applications');
    expect(source).not.toContain('lsregister" -u "$source_app"');
  });

  it('only launches after successful registration and permits explicit launch opt-in', () => {
    expect(source).toContain('launch=false');
    expect(source).toContain('--launch');
    expect(source).toContain('[[ "$launch" == true ]]');
    expect(source.indexOf('"$lsregister" -f "$stable_target"')).toBeLessThan(source.indexOf('[[ "$launch" == true ]]'));
  });
});
