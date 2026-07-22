const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { execFileSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const info = readJson("info.json");
const appcast = readJson("appcast.json");
const packageMetadata = readJson("package.json");
const packagePath = path.join(
  projectRoot,
  "bobplugin",
  `vercel-ai-gateway_${info.version}.bobplugin`,
);

test("plugin metadata and public update metadata stay aligned", () => {
  assert.match(info.identifier, /^[a-z0-9.]+$/);
  assert.equal(info.category, "translate");
  assert.equal(info.minBobVersion, "1.15.0");
  assert.equal(appcast.identifier, info.identifier);
  assert.equal(appcast.versions[0].version, info.version);
  assert.equal(appcast.versions[0].minBobVersion, info.minBobVersion);
  assert.equal(packageMetadata.version, info.version);
  assert.equal(packageMetadata.packageManager, "pnpm@10.33.0");
  assert.ok(fs.existsSync(path.join(projectRoot, "pnpm-lock.yaml")));
  assert.equal(typeof appcast.versions[0].timestamp, "number");
  assert.equal(
    path.basename(new URL(appcast.versions[0].url).pathname),
    path.basename(packagePath),
  );

  const apiKey = info.options.find((option) => option.identifier === "apiKey");
  const model = info.options.find((option) => option.identifier === "model");
  const thinkingMode = info.options.find(
    (option) => option.identifier === "thinkingMode",
  );
  assert.doesNotMatch(info.summary, /[。！？]$/);
  assert.equal(apiKey.textConfig.type, "secure");
  assert.equal(model.title, "模型");
  assert.equal(model.defaultValue, "poolside/laguna-s-2.1-free");
  assert.equal(thinkingMode.title, "深度思考");
  assert.equal(thinkingMode.defaultValue, "default");
  assert.deepEqual(
    thinkingMode.menuValues.map((item) => item.value),
    ["default", "enable", "disable"],
  );
  assert.deepEqual(
    thinkingMode.menuValues.map((item) => item.title),
    ["默认设置", "启用思考", "禁用思考"],
  );
  assert.match(
    fs.readFileSync(path.join(projectRoot, "main.js"), "utf8"),
    /function pluginValidate\(completion\)/,
  );
});

test("development documentation and workflows use pnpm", () => {
  const files = [
    "CONTRIBUTING.md",
    "README.md",
    ".github/workflows/ci.yml",
    ".github/workflows/release.yml",
  ];

  for (const file of files) {
    const contents = fs.readFileSync(path.join(projectRoot, file), "utf8");
    assert.doesNotMatch(contents, /\bnpm\b/i);
  }

  for (const file of files.slice(2)) {
    const contents = fs.readFileSync(path.join(projectRoot, file), "utf8");
    assert.match(
      contents,
      /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7\.0\.1/,
    );
    assert.match(
      contents,
      /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7\.0\.0/,
    );
    assert.match(
      contents,
      /pnpm\/action-setup@0ebf47130e4866e96fce0953f49152a61190b271 # v6\.0\.9/,
    );
  }
});

test("icon is a 256 by 256 PNG", () => {
  const png = fs.readFileSync(path.join(projectRoot, "icon.png"));
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(png.readUInt32BE(16), 256);
  assert.equal(png.readUInt32BE(20), 256);
});

test("installable package has a flat layout and matching SHA-256", () => {
  assert.ok(fs.existsSync(packagePath), `Missing ${packagePath}`);
  const files = execFileSync("unzip", ["-Z1", packagePath], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .sort();

  assert.deepEqual(files, [
    "LICENSE",
    "NOTICE",
    "icon.png",
    "info.json",
    "languages.js",
    "main.js",
  ]);

  const sha256 = crypto
    .createHash("sha256")
    .update(fs.readFileSync(packagePath))
    .digest("hex");
  assert.equal(appcast.versions[0].sha256, sha256);
});

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), "utf8"));
}
