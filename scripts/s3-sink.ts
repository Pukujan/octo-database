import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2] ?? 'C:/Users/pujan/AppData/Local/Temp/octo-s3-sink';
const port = Number(process.argv[3] ?? 4599);
mkdirSync(root, { recursive: true });

const server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const key = decodeURIComponent((req.url ?? '/').split('?')[0]!.replace(/^\/+/, ''));
    const target = join(root, key.replace(/\//g, '__'));
    writeFileSync(target, body);
    console.log(`PUT ${key} (${body.byteLength} bytes) -> ${target}`);
    res.writeHead(200, { ETag: '"sink"' });
    res.end();
  });
});
server.listen(port, () => console.log(`s3 sink on http://localhost:${port}`));
