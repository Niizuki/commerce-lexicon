import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Lexicons } from '@atproto/lexicon';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const lexiconDir = path.join(__dirname, '..', 'lexicons');

function walkDir(dir) {
  let results = [];
  for (const file of fs.readdirSync(dir)) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      results = results.concat(walkDir(filePath));
    } else if (file.endsWith('.json')) {
      results.push(filePath);
    }
  }
  return results;
}

const files = walkDir(lexiconDir);
const lexicons = new Lexicons();
let valid = 0;

for (const file of files) {
  try {
    lexicons.add(JSON.parse(fs.readFileSync(file, 'utf8')));
    console.log(`✅ ${path.relative(lexiconDir, file)}`);
    valid++;
  } catch (e) {
    console.error(`❌ ${path.relative(lexiconDir, file)}`);
    console.error(e.message);
  }
}

console.log(`\n${valid}/${files.length} valid`);
if (valid < files.length) process.exit(1);
