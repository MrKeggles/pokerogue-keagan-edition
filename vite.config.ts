/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig, loadEnv, type PluginOption, type UserConfig, type UserConfigFnPromise } from "vite";

/**
 * Default config object used for both Vitest and local dev runs.
 */
export const sharedConfig: UserConfigFnPromise = async ({ mode, command }) => {
  const optimizeForDistribution = mode === "production" || mode === "app";
  const opts = {
    clearScreen: false,
    appType: "mpa",
    build: {
      sourcemap: !optimizeForDistribution,
      chunkSizeWarningLimit: 10000,
      minify: "oxc",
      rolldownOptions: {
        // TODO: Review if we even need this anymore in v8.0
        onwarn(warning, defaultHandler) {
          // Suppress "Module level directives cause errors when bundled" warnings
          if (warning.code === "MODULE_LEVEL_DIRECTIVE") {
            return;
          }
          defaultHandler(warning);
        },
        checks: {
          // For some stupid reason, Phaser uses direct eval when loading scene classes, producing errors for a method
          // that we actively never use
          eval: false,
        },
        // Enable more aggressive tree-shaking for production builds, but disable them during dev builds (including the beta site)
        // to ensure removing statements does not mask hidden errors.
        treeshake: {
          manualPureFunctions: optimizeForDistribution ? ["console.debug", "console.log"] : [],
          propertyReadSideEffects: optimizeForDistribution ? false : "always",
          unknownGlobalSideEffects: !optimizeForDistribution,
          // TODO: This one is a bit iffy (hence why I'm disabling it for now)
          // propertyWriteSideEffects: mode === "production" ? false : "always",
        },
        // TODO: Look into configuring more rolldown options for smaller bundle size
        output: {
          keepNames: true,
          // Needed to prevent import timing issues with the phaser3 rex plugins
          strictExecutionOrder: true,
          minify: {
            mangle: {
              keepNames: true,
            },
            compress: {
              keepNames: { class: true, function: true },
            },
          },
        },
      },
    },
    resolve: {
      tsconfigPaths: true,
    },
    plugins: [] as PluginOption[],
  } satisfies UserConfig;

  if (!process.env.MERGE_REPORTS) {
    opts.plugins = [
      (await import("./plugins/vite/vite-minify-json-plugin")).minifyPublicJsonFiles(),
      (await import("./plugins/vite/namespaces-i18n-plugin")).LocaleNamespace(),
      (await import("unplugin-inline-enum/vite")).default({ scanDir: "src" }),
    ];
  }

  if (mode === "app" && command === "build") {
    const appEnv = loadEnv(mode, process.cwd());
    opts.plugins.push({
      name: "pokerogue-app-build-marker",
      async writeBundle() {
        await writeFile(
          resolve(process.cwd(), "dist", ".pokerogue-app-build.json"),
          `${JSON.stringify({ mode, serverUrl: appEnv.VITE_SERVER_URL }, null, 2)}\n`,
          "utf8",
        );
      },
    });
  }
  return opts;
};

// biome-ignore lint/style/noDefaultExport: required for Vite
export default defineConfig(async config => {
  const { mode, command } = config;
  const envPort = Number(loadEnv(mode, process.cwd()).VITE_PORT);

  return {
    ...(await sharedConfig(config)),
    base: "",
    publicDir: command === "serve" ? "assets" : false,
    server: {
      port: Number.isNaN(envPort) ? 8000 : envPort,
      watch: {
        // Desktop packaging and browser smoke tests can generate hundreds of
        // thousands of files. They are build outputs, never HMR inputs.
        ignored: ["**/release/**", "**/.edge-smoke-profile*/**"],
      },
    },
  } satisfies UserConfig;
});
