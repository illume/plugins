import { defineConfig } from '@rsbuild/core';

export default defineConfig({
  source: {
    entry: {
      cli: {
        import: './src/cli.ts',
        html: false,
      },
    },
  },
  output: {
    target: 'node',
    distPath: {
      root: 'dist',
    },
    filename: {
      js: '[name].mjs',
    },
    filenameHash: false,
    minify: true,
    sourceMap: false,
  },
  tools: {
    rspack: (config, { rspack }) => {
      config.output ??= {};
      config.output.asyncChunks = false;
      config.output.chunkFormat = 'module';
      config.output.chunkLoading = 'import';
      config.output.library = { type: 'module' };
      config.output.module = true;
      config.plugins ??= [];
      config.plugins.push(
        new rspack.BannerPlugin({
          banner: '#!/usr/bin/env node',
          entryOnly: true,
          raw: true,
        })
      );
      return config;
    },
  },
});
