import { mkdtemp, readFile, readdir, rename, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");

function run(command, args, cwd = root, env = process.env) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", env });
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status ?? 1}.`);
}

async function filesBelow(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(path));
    else files.push(path);
  }
  return files;
}

function secretValues(source) {
  return source.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return [];
    const separator = trimmed.indexOf("=");
    if (separator < 1) return [];
    const name = trimmed.slice(0, separator).trim();
    if (!/(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(name)) return [];
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    return value.length >= 8 ? [value] : [];
  });
}

function variableNames(source) {
  return source.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return [];
    const separator = trimmed.indexOf("=");
    return separator > 0 ? [trimmed.slice(0, separator).trim()] : [];
  });
}

const devVars = resolve(root, ".dev.vars");
let localVariableSource = "";
let devVarsPresent = false;
try {
  localVariableSource = await readFile(devVars, "utf8");
  devVarsPresent = true;
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
const buildEnvironment = { ...process.env };
for (const name of variableNames(localVariableSource)) delete buildEnvironment[name];
for (const name of Object.keys(buildEnvironment)) {
  if (/(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(name) || name === "CLOUDFLARE_ACCOUNT_ID") delete buildEnvironment[name];
}
for (const generatedDirectory of [dist, resolve(root, ".next"), resolve(root, ".vinext"), resolve(root, "node_modules/.vite"), resolve(root, "node_modules/.vite-temp")]) {
  await rm(generatedDirectory, { recursive: true, force: true });
}
const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "ariadne-deploy-"));
const heldDevVars = resolve(temporaryDirectory, ".dev.vars");
if (devVarsPresent) await rename(devVars, heldDevVars);
try {
  run(resolve(root, "node_modules/.bin/vinext"), ["build"], root, buildEnvironment);
} finally {
  if (devVarsPresent) await rename(heldDevVars, devVars);
  await rm(temporaryDirectory, { recursive: true });
}

const generated = await filesBelow(dist);
for (const file of generated) {
  if (file.endsWith("/.dev.vars") || file.endsWith("/.env")) await rm(file);
}

const environmentSecrets = Object.entries(process.env).flatMap(([name, value]) => /(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(name) && value && value.length >= 8 ? [value] : []);
const localSecrets = [...new Set([...secretValues(localVariableSource), ...environmentSecrets])];
for (const file of await filesBelow(dist)) {
  const bytes = await readFile(file);
  if (localSecrets.some((secret) => bytes.includes(Buffer.from(secret)))) {
    throw new Error(`Deployment stopped: generated output contains a local secret (${file.slice(root.length + 1)}).`);
  }
}

console.log("Secret scan passed; deploying sanitized output.");
run(resolve(root, "node_modules/.bin/wrangler"), ["deploy", "--config", "wrangler.json"], resolve(dist, "server"));
