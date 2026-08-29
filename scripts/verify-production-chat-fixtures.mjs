import fs from 'node:fs/promises';
import path from 'node:path';

const dist = path.resolve('dist');
const forbidden = [
  '__xenoChatMockInstalled',
  '__xenoChatMockRoute',
  'xeno_chat_mock',
  '[chatMock] Offline mock backend active',
];

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  }))).flat();
}

const files = await walk(dist);
for (const file of files.filter((candidate) => /\.(?:html|js|css|json)$/.test(candidate))) {
  const content = await fs.readFile(file, 'utf8');
  for (const signature of forbidden) {
    if (content.includes(signature)) {
      throw new Error(`Production fixture signature ${JSON.stringify(signature)} emitted in ${path.relative(dist, file)}`);
    }
  }
}
console.log(`production Chat fixture boundary passed across ${files.length} emitted files`);
