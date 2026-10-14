// Two builds from one codebase:
//   web      the playtest build on Cloudflare (dist/), with version.json for the reload check
//   desktop  the Electron build (dist-desktop/), relative paths, no version check
import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig(({ mode }) => {
  const target = mode === 'desktop' ? 'desktop' : 'web';
  // One id per build: the version plus a UTC timestamp. The web page compares it with version.json.
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const buildId = `${pkg.version}+${stamp}`;
  return {
    base: target === 'desktop' ? './' : '/',
    define: {
      __TARGET__: JSON.stringify(target),
      __BUILD_ID__: JSON.stringify(buildId),
      __VERSION__: JSON.stringify(pkg.version),
    },
    build: {
      outDir: target === 'desktop' ? 'dist-desktop' : 'dist',
      emptyOutDir: true,
      target: 'es2022',
      assetsInlineLimit: 0,
      chunkSizeWarningLimit: 2000,
    },
    plugins: [{
      name: 'lamplight-version-json',
      apply: 'build',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: buildId, version: pkg.version, target }) });
      },
    }],
  };
});
