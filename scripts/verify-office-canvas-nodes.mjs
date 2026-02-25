import fs from 'fs';

const filePath = '/work/xeno-platform/src/components/office/CanvasPlanningVisual.tsx';
const src = fs.readFileSync(filePath, 'utf8');

const getBlock = (startToken, endToken, from = 0) => {
  const start = src.indexOf(startToken, from);
  if (start === -1) return '';
  const end = src.indexOf(endToken, start);
  if (end === -1) return src.slice(start);
  return src.slice(start, end + endToken.length);
};

const registryBlock = getBlock('const NODE_REGISTRY', '];');
const addNodeBlock = getBlock('const addNode = (type: NodeType, color?: string) => {', 'setShowNodeMenu(false);');
const renderNodeBlock = getBlock('const renderNode = (node: Node) => {', 'const categories = [');

const extractTypes = (text, regex) => {
  const out = new Set();
  for (const m of text.matchAll(regex)) out.add(m[1]);
  return out;
};

const registryTypes = extractTypes(registryBlock, /\{\s*type:\s*'([^']+)'/g);
const addCaseTypes = extractTypes(addNodeBlock, /case\s+'([^']+)'\s*:/g);
const renderTypes = extractTypes(renderNodeBlock, /node\.type\s*===\s*'([^']+)'/g);
const sizeMapTypes = extractTypes(addNodeBlock, /\n\s*([a-zA-Z0-9_]+):\s*\{\s*width:/g);

const sorted = (set) => [...set].sort();
const allRegistry = sorted(registryTypes);

const rows = allRegistry.map((type) => {
  const inSizeMap = sizeMapTypes.has(type);
  const inInitCase = addCaseTypes.has(type);
  const inRender = renderTypes.has(type);
  const ok = inRender && (inSizeMap || true) && (inInitCase || true);
  return { type, inSizeMap, inInitCase, inRender, ok };
});

const missingRender = rows.filter((r) => !r.inRender).map((r) => r.type);
const missingSizeMap = rows.filter((r) => !r.inSizeMap).map((r) => r.type);
const missingInit = rows.filter((r) => !r.inInitCase).map((r) => r.type);

console.log('Office Canvas Node Audit');
console.log(`Source: ${filePath}`);
console.log(`Registry types: ${allRegistry.length}`);
console.log('');

for (const r of rows) {
  const flags = [
    r.inRender ? 'render:ok' : 'render:MISS',
    r.inSizeMap ? 'size:ok' : 'size:default',
    r.inInitCase ? 'init:ok' : 'init:default',
  ].join(' | ');
  console.log(`${r.type.padEnd(12)} ${flags}`);
}

console.log('');
console.log(`Missing render implementations: ${missingRender.length ? missingRender.join(', ') : 'none'}`);
console.log(`Missing explicit size map entries: ${missingSizeMap.length ? missingSizeMap.join(', ') : 'none'}`);
console.log(`Missing explicit init cases: ${missingInit.length ? missingInit.join(', ') : 'none'}`);

if (missingRender.length > 0) process.exit(1);
