import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync
} from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = dirname(dirname(fileURLToPath(import.meta.url)));

export const frontendRuntimeAssets = [
  {
    id: 'highlight',
    displayName: 'Highlight.js CDN assets',
    packageName: '@highlightjs/cdn-assets',
    bundledPaths: 'assets/vendor/highlight/highlight.min.js, assets/vendor/highlight/styles/*.css',
    purpose: 'Local syntax highlighting script and bundled Highlight.js code themes.',
    noticeLocation: 'assets/vendor/highlight/LICENSE',
    managedRoot: 'assets/vendor/highlight',
    copies: [
      ['node_modules/@highlightjs/cdn-assets/highlight.min.js', 'assets/vendor/highlight/highlight.min.js', 'file'],
      ['node_modules/@highlightjs/cdn-assets/LICENSE', 'assets/vendor/highlight/LICENSE', 'file'],
      ['node_modules/@highlightjs/cdn-assets/styles/github.min.css', 'assets/vendor/highlight/styles/github.min.css', 'file'],
      ['node_modules/@highlightjs/cdn-assets/styles/github-dark.min.css', 'assets/vendor/highlight/styles/github-dark.min.css', 'file'],
      ['node_modules/@highlightjs/cdn-assets/styles/atom-one-dark.min.css', 'assets/vendor/highlight/styles/atom-one-dark.min.css', 'file'],
      ['node_modules/@highlightjs/cdn-assets/styles/atom-one-light.min.css', 'assets/vendor/highlight/styles/atom-one-light.min.css', 'file'],
      ['node_modules/@highlightjs/cdn-assets/styles/monokai.min.css', 'assets/vendor/highlight/styles/monokai.min.css', 'file'],
      ['node_modules/@highlightjs/cdn-assets/styles/vs2015.min.css', 'assets/vendor/highlight/styles/vs2015.min.css', 'file'],
      ['node_modules/@highlightjs/cdn-assets/styles/xcode.min.css', 'assets/vendor/highlight/styles/xcode.min.css', 'file']
    ].map(([source, destination, type]) => ({ source, destination, type }))
  },
  {
    id: 'inter',
    displayName: 'Inter Latin variable font',
    version: '4.1',
    source: 'https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7W0Q5nw.woff2',
    license: 'OFL-1.1',
    bundledPaths: 'assets/vendor/inter/inter-latin-variable.woff2',
    purpose: 'Theme-isolated typography for the immersive writing workspace.',
    noticeLocation: 'assets/vendor/inter/LICENSE',
    managedRoot: 'assets/vendor/inter',
    copies: [
      {
        source: 'scripts/vendor-fonts/inter/inter-latin-variable.woff2',
        destination: 'assets/vendor/inter/inter-latin-variable.woff2',
        type: 'file'
      },
      {
        source: 'scripts/vendor-fonts/inter/LICENSE',
        destination: 'assets/vendor/inter/LICENSE',
        type: 'file'
      }
    ]
  },
  {
    id: 'jetbrains-mono',
    displayName: 'JetBrains Mono Latin variable font',
    version: '2.304',
    source: 'https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPxDcwgknk-4.woff2',
    license: 'OFL-1.1',
    bundledPaths: 'assets/vendor/jetbrains-mono/jetbrains-mono-latin-variable.woff2',
    purpose: 'Theme-isolated source and statistics typography for the immersive writing workspace.',
    noticeLocation: 'assets/vendor/jetbrains-mono/LICENSE',
    managedRoot: 'assets/vendor/jetbrains-mono',
    copies: [
      {
        source: 'scripts/vendor-fonts/jetbrains-mono/jetbrains-mono-latin-variable.woff2',
        destination: 'assets/vendor/jetbrains-mono/jetbrains-mono-latin-variable.woff2',
        type: 'file'
      },
      {
        source: 'scripts/vendor-fonts/jetbrains-mono/LICENSE',
        destination: 'assets/vendor/jetbrains-mono/LICENSE',
        type: 'file'
      }
    ]
  },
  {
    id: 'lora',
    displayName: 'Lora Latin variable font',
    version: 'Google Fonts v37',
    source: 'https://fonts.gstatic.com/s/lora/v37/',
    license: 'OFL-1.1',
    bundledPaths: 'assets/vendor/lora/lora-latin-variable.woff2, assets/vendor/lora/lora-latin-italic-variable.woff2',
    purpose: 'Local serif typography for the immersive revision preview.',
    noticeLocation: 'assets/vendor/lora/LICENSE',
    managedRoot: 'assets/vendor/lora',
    copies: [
      {
        source: 'scripts/vendor-fonts/lora/lora-latin-variable.woff2',
        destination: 'assets/vendor/lora/lora-latin-variable.woff2',
        type: 'file'
      },
      {
        source: 'scripts/vendor-fonts/lora/lora-latin-italic-variable.woff2',
        destination: 'assets/vendor/lora/lora-latin-italic-variable.woff2',
        type: 'file'
      },
      {
        source: 'scripts/vendor-fonts/lora/LICENSE',
        destination: 'assets/vendor/lora/LICENSE',
        type: 'file'
      }
    ]
  },
  {
    id: 'katex',
    displayName: 'KaTeX',
    packageName: 'katex',
    bundledPaths: 'assets/vendor/katex/katex.min.js, assets/vendor/katex/katex.min.css, assets/vendor/katex/fonts/',
    purpose: 'Local math rendering script, stylesheet, and fonts.',
    noticeLocation: 'assets/vendor/katex/LICENSE',
    managedRoot: 'assets/vendor/katex',
    copies: [
      {
        source: 'node_modules/katex/dist/katex.min.js',
        destination: 'assets/vendor/katex/katex.min.js',
        type: 'file'
      },
      {
        source: 'node_modules/katex/dist/katex.min.css',
        destination: 'assets/vendor/katex/katex.min.css',
        type: 'file'
      },
      {
        source: 'node_modules/katex/LICENSE',
        destination: 'assets/vendor/katex/LICENSE',
        type: 'file'
      },
      {
        source: 'node_modules/katex/dist/fonts',
        destination: 'assets/vendor/katex/fonts',
        type: 'directory'
      }
    ]
  },
  {
    id: 'mermaid',
    displayName: 'Mermaid',
    packageName: 'mermaid',
    bundledPaths: 'assets/vendor/mermaid/mermaid.min.js',
    purpose: 'Local diagram rendering script.',
    noticeLocation: 'assets/vendor/mermaid/LICENSE',
    managedRoot: 'assets/vendor/mermaid',
    copies: [
      {
        source: 'node_modules/mermaid/dist/mermaid.min.js',
        destination: 'assets/vendor/mermaid/mermaid.min.js',
        type: 'file'
      },
      {
        source: 'scripts/vendor-licenses/mermaid-LICENSE',
        destination: 'assets/vendor/mermaid/LICENSE',
        type: 'file'
      }
    ]
  },
  {
    id: 'lucide',
    displayName: 'Lucide icon paths',
    version: '0.487.0',
    source: 'https://github.com/lucide-icons/lucide/tree/0.487.0',
    license: 'ISC',
    bundledPaths: 'assets/js/admin/immersive-workspace.js',
    purpose: 'Locally embedded SVG path data for the isolated immersive workspace controls.',
    noticeLocation: 'assets/vendor/lucide/LICENSE',
    managedRoot: 'assets/vendor/lucide',
    requiredPaths: [
      {
        path: 'assets/js/admin/immersive-workspace.js',
        type: 'file'
      }
    ],
    copies: [
      {
        source: 'scripts/vendor-licenses/lucide-LICENSE',
        destination: 'assets/vendor/lucide/LICENSE',
        type: 'file'
      }
    ]
  }
];

function isRepositoryRelativePath(path) {
  return typeof path === 'string'
    && path.length > 0
    && !isAbsolute(path)
    && !/^[a-z][a-z\d+.-]*:/i.test(path)
    && !path.includes('\\')
    && path.split('/').every((segment) => segment && !['.', '..'].includes(segment));
}

function isLocalVendorPath(path) {
  return isRepositoryRelativePath(path) && path.startsWith('assets/vendor/');
}

function normalizedCopies(component) {
  return Array.isArray(component.copies) ? component.copies : [];
}

function hasNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasLicenseMetadata(value) {
  return hasNonEmptyString(value)
    || (Array.isArray(value) && value.length > 0 && value.every(hasNonEmptyString));
}

export function validateFrontendAssetManifest(manifest = frontendRuntimeAssets) {
  if (!Array.isArray(manifest) || !manifest.length) {
    throw new Error('The frontend runtime asset manifest must contain at least one component.');
  }

  const componentIds = new Set();
  const destinations = new Set();
  const managedRoots = new Set();

  for (const component of manifest) {
    if (!component || !hasNonEmptyString(component.id)) {
      throw new Error('Every frontend runtime asset component requires a stable id.');
    }
    if (componentIds.has(component.id)) {
      throw new Error(`Duplicate frontend runtime asset component id: ${component.id}.`);
    }
    componentIds.add(component.id);

    for (const field of ['displayName', 'bundledPaths', 'purpose']) {
      if (!hasNonEmptyString(component[field])) {
        throw new Error(`${component.id} requires non-empty ${field} metadata.`);
      }
    }

    if (Object.hasOwn(component, 'packageName') && !hasNonEmptyString(component.packageName)) {
      throw new Error(`${component.id} packageName must be a non-empty package identifier.`);
    }
    if (!component.packageName) {
      for (const field of ['version', 'source']) {
        if (!hasNonEmptyString(component[field])) {
          throw new Error(`${component.id} requires non-empty ${field} provenance metadata.`);
        }
      }
      if (!hasLicenseMetadata(component.license)) {
        throw new Error(`${component.id} requires explicit license metadata.`);
      }
    }

    if (!isLocalVendorPath(component.noticeLocation)) {
      throw new Error(`${component.id} noticeLocation must stay under assets/vendor/.`);
    }

    if (Object.hasOwn(component, 'copies') && !Array.isArray(component.copies)) {
      throw new Error(`${component.id} copies must be an array.`);
    }
    if (component.managedRoot) {
      if (!isLocalVendorPath(component.managedRoot)) {
        throw new Error(`${component.id} managedRoot must stay under assets/vendor/.`);
      }
      for (const managedRoot of managedRoots) {
        if (
          component.managedRoot === managedRoot
          || component.managedRoot.startsWith(`${managedRoot}/`)
          || managedRoot.startsWith(`${component.managedRoot}/`)
        ) {
          throw new Error(
            `${component.id} and another component's managed roots overlap: ${component.managedRoot}.`
          );
        }
      }
      managedRoots.add(component.managedRoot);
    }

    if (component.requiredPaths && !Array.isArray(component.requiredPaths)) {
      throw new Error(`${component.id} requiredPaths must be an array.`);
    }
    if (!normalizedCopies(component).length && !(component.requiredPaths || []).length) {
      throw new Error(`${component.id} requires at least one copied or required runtime path.`);
    }
    for (const requirement of component.requiredPaths || []) {
      if (
        !requirement
        || !['file', 'dir', 'non-empty-dir'].includes(requirement.type)
        || !isRepositoryRelativePath(requirement.path)
      ) {
        throw new Error(`${component.id} required paths must stay inside the repository and use a supported type.`);
      }
    }

    for (const copy of normalizedCopies(component)) {
      if (!copy || !['file', 'directory'].includes(copy.type)) {
        throw new Error(`${component.id} copy entries require a file or directory type.`);
      }
      if (!isRepositoryRelativePath(copy.source)) {
        throw new Error(`${component.id} copy sources must be repository-relative paths.`);
      }
      if (!isLocalVendorPath(copy.destination)) {
        throw new Error(`${component.id} copy destinations must stay under assets/vendor/.`);
      }
      if (!component.managedRoot || (copy.destination !== component.managedRoot && !copy.destination.startsWith(`${component.managedRoot}/`))) {
        throw new Error(`${component.id} copy destination must stay inside its managedRoot.`);
      }
      if (destinations.has(copy.destination)) {
        throw new Error(`Duplicate frontend runtime destination: ${copy.destination}.`);
      }
      destinations.add(copy.destination);
    }
  }

  return manifest;
}

function readJson(root, path) {
  const absolute = join(root, path);

  if (!existsSync(absolute)) {
    return null;
  }

  return JSON.parse(readFileSync(absolute, 'utf8'));
}

function mismatch(code, path, message) {
  return { code, path, message };
}

export function findFrontendAssetPackageMismatches(root = defaultRoot, manifest = frontendRuntimeAssets) {
  validateFrontendAssetManifest(manifest);

  const mismatches = [];
  const packageJson = readJson(root, 'package.json');
  const packageLock = readJson(root, 'package-lock.json');

  for (const component of manifest) {
    if (!component.packageName) {
      continue;
    }

    if (!packageJson?.dependencies || !Object.hasOwn(packageJson.dependencies, component.packageName)) {
      mismatches.push(mismatch(
        'missing-package-dependency',
        component.packageName,
        `${component.id} requires ${component.packageName} in package.json dependencies.`
      ));
    }

    if (!packageLock?.packages?.['']?.dependencies || !Object.hasOwn(packageLock.packages[''].dependencies, component.packageName)) {
      mismatches.push(mismatch(
        'missing-lock-dependency',
        component.packageName,
        `${component.id} requires ${component.packageName} in the package-lock root dependencies.`
      ));
    }

    const packageMetadata = packageLock?.packages?.[`node_modules/${component.packageName}`];
    if (!packageMetadata) {
      mismatches.push(mismatch(
        'missing-lock-package',
        component.packageName,
        `${component.id} requires locked metadata for ${component.packageName}.`
      ));
      continue;
    }

    if (!hasNonEmptyString(packageMetadata.version)) {
      mismatches.push(mismatch(
        'missing-lock-version',
        component.packageName,
        `${component.id} requires a locked version for ${component.packageName}.`
      ));
    }
    if (!hasNonEmptyString(packageMetadata.resolved) && !hasNonEmptyString(packageMetadata.source)) {
      mismatches.push(mismatch(
        'missing-lock-source',
        component.packageName,
        `${component.id} requires locked source provenance for ${component.packageName}.`
      ));
    }
    if (!hasLicenseMetadata(packageMetadata.license)) {
      mismatches.push(mismatch(
        'missing-lock-license',
        component.packageName,
        `${component.id} requires explicit locked license metadata for ${component.packageName}.`
      ));
    }
  }

  return mismatches;
}

function walkRelativeFiles(root, path) {
  const absolute = join(root, path);

  if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
    return [];
  }

  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory)) {
      const child = join(directory, entry);
      const stat = statSync(child);

      if (stat.isDirectory()) {
        visit(child);
      } else if (stat.isFile()) {
        files.push(relative(root, child).split(/[\\/]+/).join('/'));
      }
    }
  };

  visit(absolute);
  return files.sort();
}

function expectedDestinationFiles(root, component, mismatches) {
  const expected = new Map();
  let canCheckUnexpectedFiles = true;

  for (const copy of normalizedCopies(component)) {
    const source = join(root, copy.source);

    if (!existsSync(source)) {
      mismatches.push(mismatch('missing-source', copy.source, `Missing frontend runtime source: ${copy.source}.`));
      if ('file' === copy.type) {
        expected.set(copy.destination, copy.source);
      } else {
        canCheckUnexpectedFiles = false;
      }
      continue;
    }

    const sourceStat = statSync(source);
    if (('file' === copy.type && !sourceStat.isFile()) || ('directory' === copy.type && !sourceStat.isDirectory())) {
      mismatches.push(mismatch('invalid-source-type', copy.source, `Frontend runtime source has the wrong type: ${copy.source}.`));
      canCheckUnexpectedFiles = false;
      continue;
    }

    if ('file' === copy.type) {
      expected.set(copy.destination, copy.source);
      continue;
    }

    const sourceFiles = walkRelativeFiles(root, copy.source);
    if (!sourceFiles.length) {
      mismatches.push(mismatch('empty-source', copy.source, `Frontend runtime source directory is empty: ${copy.source}.`));
      canCheckUnexpectedFiles = false;
      continue;
    }

    for (const sourceFile of sourceFiles) {
      const suffix = relative(copy.source, sourceFile).split(/[\\/]+/).join('/');
      expected.set(`${copy.destination}/${suffix}`, sourceFile);
    }
  }

  return { expected, canCheckUnexpectedFiles };
}

function findRequiredPathMismatches(root, component) {
  const mismatches = [];

  for (const requirement of component.requiredPaths || []) {
    const absolute = join(root, requirement.path);

    if (!existsSync(absolute)) {
      mismatches.push(mismatch(
        'missing-required-path',
        requirement.path,
        `Missing required frontend runtime path: ${requirement.path}.`
      ));
      continue;
    }

    const stat = statSync(absolute);
    const expectsDirectory = ['dir', 'non-empty-dir'].includes(requirement.type);
    if (
      ('file' === requirement.type && !stat.isFile())
      || (expectsDirectory && !stat.isDirectory())
    ) {
      mismatches.push(mismatch(
        'invalid-required-path-type',
        requirement.path,
        `Required frontend runtime path has the wrong type: ${requirement.path}.`
      ));
      continue;
    }

    if ('non-empty-dir' === requirement.type && 0 === readdirSync(absolute).length) {
      mismatches.push(mismatch(
        'empty-required-path',
        requirement.path,
        `Required frontend runtime directory is empty: ${requirement.path}.`
      ));
    }
  }

  return mismatches;
}

export function findFrontendAssetMismatches(root = defaultRoot, manifest = frontendRuntimeAssets) {
  validateFrontendAssetManifest(manifest);

  const mismatches = findFrontendAssetPackageMismatches(root, manifest);

  for (const component of manifest) {
    const { expected, canCheckUnexpectedFiles } = expectedDestinationFiles(root, component, mismatches);

    for (const [destinationPath, sourcePath] of expected) {
      const destination = join(root, destinationPath);
      const source = join(root, sourcePath);

      if (!existsSync(destination) || !statSync(destination).isFile()) {
        mismatches.push(mismatch(
          'missing-destination',
          destinationPath,
          `Missing prepared frontend runtime asset: ${destinationPath}.`
        ));
        continue;
      }

      if (existsSync(source) && !readFileSync(source).equals(readFileSync(destination))) {
        mismatches.push(mismatch(
          'content-mismatch',
          destinationPath,
          `Prepared frontend runtime asset differs from ${sourcePath}: ${destinationPath}.`
        ));
      }
    }

    if (component.managedRoot && canCheckUnexpectedFiles) {
      const expectedPaths = new Set(expected.keys());
      for (const destinationPath of walkRelativeFiles(root, component.managedRoot)) {
        if (!expectedPaths.has(destinationPath)) {
          mismatches.push(mismatch(
            'unexpected-destination',
            destinationPath,
            `Unexpected file in managed frontend runtime directory: ${destinationPath}.`
          ));
        }
      }
    }

    mismatches.push(...findRequiredPathMismatches(root, component));

    const notice = join(root, component.noticeLocation);
    if (!existsSync(notice) || !statSync(notice).isFile()) {
      mismatches.push(mismatch(
        'missing-notice',
        component.noticeLocation,
        `Missing frontend runtime license or notice: ${component.noticeLocation}.`
      ));
    }
  }

  return mismatches;
}

function assertSourcesAvailable(root, manifest) {
  const failures = [];

  failures.push(...findFrontendAssetPackageMismatches(root, manifest));
  for (const component of manifest) {
    for (const copy of normalizedCopies(component)) {
      const source = join(root, copy.source);
      if (!existsSync(source)) {
        failures.push(mismatch('missing-source', copy.source, `Missing frontend runtime source: ${copy.source}.`));
        continue;
      }

      const sourceStat = statSync(source);
      if (('file' === copy.type && !sourceStat.isFile()) || ('directory' === copy.type && !sourceStat.isDirectory())) {
        failures.push(mismatch('invalid-source-type', copy.source, `Frontend runtime source has the wrong type: ${copy.source}.`));
      }
    }
  }

  if (failures.length) {
    throw new Error([
      'Frontend runtime assets cannot be prepared:',
      ...failures.map((failure) => `- ${failure.message}`)
    ].join('\n'));
  }
}

export function prepareFrontendAssets(root = defaultRoot, manifest = frontendRuntimeAssets) {
  validateFrontendAssetManifest(manifest);
  assertSourcesAvailable(root, manifest);

  for (const component of manifest) {
    if (component.managedRoot && normalizedCopies(component).length) {
      rmSync(join(root, component.managedRoot), { recursive: true, force: true });
    }
  }

  for (const component of manifest) {
    for (const copy of normalizedCopies(component)) {
      const source = join(root, copy.source);
      const destination = join(root, copy.destination);

      mkdirSync(dirname(destination), { recursive: true });
      cpSync(source, destination, {
        recursive: 'directory' === copy.type,
        dereference: true
      });
    }
  }

  const mismatches = findFrontendAssetMismatches(root, manifest);
  if (mismatches.length) {
    throw new Error([
      'Prepared frontend runtime assets did not pass validation:',
      ...mismatches.map((item) => `- ${item.message}`)
    ].join('\n'));
  }
}

function uniqueRequirements(requirements) {
  const seen = new Set();

  return requirements.filter((requirement) => {
    const key = `${requirement.type}:${requirement.path}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function frontendRuntimeReleaseRequirements(manifest = frontendRuntimeAssets) {
  validateFrontendAssetManifest(manifest);

  return uniqueRequirements(manifest.flatMap((component) => [
    ...normalizedCopies(component).map((copy) => ({
      path: copy.destination,
      type: 'directory' === copy.type ? 'non-empty-dir' : 'file'
    })),
    ...(component.requiredPaths || []),
    {
      path: component.noticeLocation,
      type: 'file'
    }
  ]));
}
