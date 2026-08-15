/*
 * SPDX-FileCopyrightText: 2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

/**
 * @typedef {{
 *   name: string,
 *   version: string,
 *   dependencies?: Record<string, string>,
 *   optionalDependencies?: Record<string, string>,
 * }} PackageManifest
 */

/**
 * @param {string} packageRoot
 * @returns {PackageManifest}
 */
function readPackage(packageRoot) {
  return JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
}

/**
 * @param {string} entryPath
 * @param {string} packageName
 */
function findPackageRoot(entryPath, packageName) {
  let current = fs.statSync(entryPath).isDirectory() ? entryPath : path.dirname(entryPath);
  while (true) {
    const manifestPath = path.join(current, "package.json");
    if (fs.existsSync(manifestPath)) {
      /** @type {PackageManifest} */
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      if (manifest.name === packageName) {
        return fs.realpathSync(current);
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`Could not find the package root for ${packageName} from ${entryPath}`);
    }
    current = parent;
  }
}

/**
 * @param {string} packageName
 * @param {string} fromDirectory
 */
function resolvePackageRoot(packageName, fromDirectory) {
  const resolver = createRequire(path.join(fromDirectory, "package.json"));
  return findPackageRoot(resolver.resolve(packageName), packageName);
}

/**
 * @param {string} sourceRoot
 * @param {string} targetRoot
 */
function copyPackageFiles(sourceRoot, targetRoot) {
  fs.cpSync(sourceRoot, targetRoot, {
    recursive: true,
    dereference: true,
    errorOnExist: true,
    filter: sourcePath => {
      const relativePath = path.relative(sourceRoot, sourcePath);
      return relativePath === "" || relativePath.split(path.sep)[0] !== "node_modules";
    },
  });
}

/**
 * @param {string} packageName
 * @param {string} fromDirectory
 * @param {string} targetRoot
 * @param {Set<string>} [ancestry]
 */
function stageDependency(packageName, fromDirectory, targetRoot, ancestry = new Set()) {
  const sourceRoot = resolvePackageRoot(packageName, fromDirectory);
  if (ancestry.has(sourceRoot)) {
    return;
  }

  const manifest = readPackage(sourceRoot);
  copyPackageFiles(sourceRoot, targetRoot);

  const nextAncestry = new Set(ancestry);
  nextAncestry.add(sourceRoot);
  /** @type {Record<string, string>} */
  const dependencies = {
    ...(manifest.dependencies ?? {}),
    ...(manifest.optionalDependencies ?? {}),
  };

  for (const dependencyName of [...Object.keys(dependencies)].sort()) {
    let dependencySourceRoot;
    try {
      dependencySourceRoot = resolvePackageRoot(dependencyName, sourceRoot);
    } catch (err) {
      if (Object.hasOwn(manifest.optionalDependencies ?? {}, dependencyName)) {
        continue;
      }
      throw err;
    }

    if (nextAncestry.has(dependencySourceRoot)) {
      continue;
    }

    stageDependency(
      dependencyName,
      sourceRoot,
      path.join(targetRoot, "node_modules", ...dependencyName.split("/")),
      nextAncestry,
    );
  }
}

function main() {
  const [packageName, stagingDirectory] = process.argv.slice(2);
  if (!packageName || !stagingDirectory) {
    throw new Error("Usage: node stage-node-dependency.cjs <package-name> <staging-directory>");
  }

  const resolvedStagingDirectory = path.resolve(stagingDirectory);
  const targetRoot = path.join(resolvedStagingDirectory, "node_modules", ...packageName.split("/"));
  if (fs.existsSync(targetRoot)) {
    throw new Error(`Refusing to overwrite an existing staged dependency: ${targetRoot}`);
  }

  stageDependency(packageName, process.cwd(), targetRoot);
  const stagedManifest = readPackage(targetRoot);
  console.log(`Staged ${stagedManifest.name}@${stagedManifest.version} and its production dependencies.`);
}

main();
