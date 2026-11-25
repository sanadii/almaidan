import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import ts from 'typescript';

const extensions = new Set(['.ts', '.tsx', '.css']);
const hex = /#[0-9a-f]{3,8}\b/i;
const rgb = /\brgb(?:a)?\s*\(/i;
const accent = /\b(?:yellow|amber|gold|violet|indigo)\b/i;
const gradient = /\b(?:linear|radial|conic)-gradient\s*\(/i;
const shadowToken = /^var\(--(?:focus-ring|shadow-[\w-]+|spatial-[\w-]+-shadow|arena-[\w-]+-shadow(?:-[\w-]+)?|arena-plate-recessed|arena-line-ring)\)$/;
const radiusToken = /^(?:var\(--(?:radius-[\w-]+|spatial-radius-[\w-]+|arena-radius-[\w-]+|space-1)\)|0|inherit|50%)$/;
const computedRadius = 'calc(var(--spatial-radius-control) - var(--space-1))';
const svgStopToken = /^var\(--(?:app|arena|material|spatial)-[\w-]+\)$/;
const bareHex = new RegExp(`^${hex.source}$`, 'i');
const bareRgb = /^rgba?\([^()]+\)$/i;
const gradientStart = /^(?:linear|radial|conic)-gradient\s*\(/i;
const visualAttributes = new Set(['style', 'color', 'fill', 'stroke', 'stopColor', 'floodColor', 'lightingColor']);
const withoutReferences = (value: string) => value
  .replace(/url\((?:[^"'()]|"[^"]*"|'[^']*')*\)/gi, '')
  .replace(/var\(\s*--[\w-]+/g, 'var(');

function qrEncoderColor(node: ts.StringLiteralLike, path: string, source: ts.SourceFile) {
  if (path !== 'src/routes/GameRoutes.tsx' || !ts.isPropertyAssignment(node.parent)) return false;
  const { name, parent: colors } = node.parent;
  if (!(name.getText(source) === 'dark' && node.text === '#071d38' || name.getText(source) === 'light' && node.text === '#ffffffff')) return false;
  const color = colors.parent;
  if (!ts.isPropertyAssignment(color) || color.name.getText(source) !== 'color' || !ts.isObjectLiteralExpression(colors) || colors.properties.length !== 2) return false;
  const call = color.parent.parent;
  return ts.isCallExpression(call) && call.expression.getText(source) === 'QRCode.toDataURL' && call.arguments[1] === color.parent;
}

function checkCss(content: string) {
  const declarations = content.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(?:^|[;{])\s*([\w-]+)\s*:\s*([^;{}]+)(?=[;}]|$)/gm);
  const values: string[] = [], errors: string[] = [];
  for (const [, property, raw] of declarations) {
    const value = raw.replace(/\s*!important\s*$/i, '').trim();
    values.push(withoutReferences(value));
    if (property === 'box-shadow' && value !== 'none' && !value.split(',').every(part => shadowToken.test(part.trim())))
      errors.push('non-tokenized box-shadow');
    if (property === 'border-radius' && value !== computedRadius && !value.split(/[\s/]+/).every(part => radiusToken.test(part)))
      errors.push('non-tokenized border radius');
  }
  return [
    ...[hex, rgb, accent, gradient].filter(pattern => values.some(value => pattern.test(value))).map(String),
    ...errors,
  ];
}

function checkScript(content: string, path: string) {
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
  const errors = new Set<string>();
  function inVisualContext(node: ts.Node) {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (ts.isJsxAttribute(parent)) return visualAttributes.has(parent.name.getText(source));
      if (ts.isCallExpression(parent) || ts.isStatement(parent)) return false;
    }
    return false;
  }
  function visit(node: ts.Node) {
    if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) {
      if (ts.isStringLiteralLike(node) && qrEncoderColor(node, path, source)) return;
      if (inVisualContext(node)) {
        const value = withoutReferences(node.text);
        for (const pattern of [hex, rgb, accent, gradient])
          if (pattern.test(value)) errors.add(String(pattern));
      } else {
        if (bareHex.test(node.text)) errors.add(String(hex));
        if (bareRgb.test(node.text)) errors.add(String(rgb));
        if (gradientStart.test(node.text)) errors.add(String(gradient));
      }
    }
    if (ts.isJsxAttribute(node) && node.name.getText(source) === 'stopColor') {
      const value = node.initializer && ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer;
      if (!value || !ts.isStringLiteralLike(value) || !svgStopToken.test(value.text.trim()))
        errors.add('non-token SVG gradient stop');
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return [...errors];
}

async function filesAt(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = join(path, entry.name);
    if (entry.isDirectory()) return filesAt(target);
    return extensions.has(entry.name.slice(entry.name.lastIndexOf('.'))) ? [target] : [];
  }));
  return nested.flat();
}

/**
 * Structural-only validation. Canonical palette declarations belong in
 * design/tokens.css; this scan deliberately rejects raw literals in src/.
 */
export async function scanVisualContract(projectRoot = process.cwd()): Promise<string[]> {
  const sourceRoot = join(projectRoot, 'src');
  const failures: string[] = [];
  for (const file of await filesAt(sourceRoot)) {
    const content = await readFile(file, 'utf8');
    const pathFromRoot = relative(projectRoot, file).replaceAll('\\', '/');
    const errors = file.endsWith('.css') ? checkCss(content) : checkScript(content, pathFromRoot);
    failures.push(...errors.map(error => `${pathFromRoot}: ${error}`));
  }
  return failures;
}

const invoked = process.argv[1]?.replaceAll('\\', '/').endsWith('/scripts/scan-visual-contract.ts');
if (invoked) {
  const failures = await scanVisualContract();
  if (failures.length) {
    console.error('Visual contract scan failed:\n' + failures.join('\n'));
    process.exitCode = 1;
  } else {
    console.log('Visual contract scan passed. Shared styles use the semantic palette and named radius, shadow, and gradient values.');
  }
}
