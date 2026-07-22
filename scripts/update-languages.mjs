import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const SOURCE_URL = "https://bobtranslate.com/plugin/addition/language.html";
const sourcePath = process.argv[2];
const html = sourcePath
  ? await readFile(sourcePath, "utf8")
  : await fetch(SOURCE_URL).then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to download ${SOURCE_URL}: ${response.status}`);
      }
      return response.text();
    });

const rowPattern =
  /<tr><td[^>]*>(.*?)<\/td><td[^>]*>(.*?)<\/td><td[^>]*>(.*?)<\/td><\/tr>/gs;
const entries = [];
const seenCodes = new Set();

for (const match of html.matchAll(rowPattern)) {
  const englishName = decodeHtml(match[2]);
  const code = decodeHtml(match[3]);

  if (!code || seenCodes.has(code)) {
    throw new Error(`Invalid or duplicate Bob language code: ${code}`);
  }

  seenCodes.add(code);
  entries.push([code, englishName]);
}

if (entries.length < 100) {
  throw new Error(`Expected Bob's language table, found ${entries.length} rows`);
}

const output =
  '"use strict";\n\n' +
  `// Generated from ${SOURCE_URL} by scripts/update-languages.mjs.\n` +
  `module.exports = Object.freeze(${JSON.stringify(Object.fromEntries(entries), null, 2)});\n`;

const outputPath = fileURLToPath(new URL("../languages.js", import.meta.url));
await writeFile(outputPath, output, "utf8");
console.log(`Updated ${outputPath} with ${entries.length} languages`);

function decodeHtml(value) {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x?[0-9a-f]+|amp|apos|gt|lt|nbsp|quot);/gi, (_match, entity) => {
      const named = {
        amp: "&",
        apos: "'",
        gt: ">",
        lt: "<",
        nbsp: " ",
        quot: '"',
      };

      if (entity.charAt(0) !== "#") {
        return named[entity.toLowerCase()] || _match;
      }

      const hexadecimal = entity.charAt(1).toLowerCase() === "x";
      const digits = entity.slice(hexadecimal ? 2 : 1);
      return String.fromCodePoint(Number.parseInt(digits, hexadecimal ? 16 : 10));
    })
    .trim();
}
