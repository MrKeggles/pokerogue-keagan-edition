/*
 * SPDX-FileCopyrightText: 2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const websiteRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: websiteRoot,
  base: "./",
  publicDir: path.join(websiteRoot, "public"),
  build: {
    outDir: path.resolve(websiteRoot, "..", "release", "site"),
    emptyOutDir: true,
  },
});
