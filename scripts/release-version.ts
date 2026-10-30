import fs from 'node:fs/promises';
import { versions } from './runtime-artifacts.ts';

const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
const tag = process.env.RELEASE_TAG || (process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : '');
if (!tag || !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) throw new Error('发布标签需要 v0.1.0 或 v0.1.0-beta.1 格式');
if (tag !== 'v' + pkg.version) throw new Error(`标签 ${tag} 与 package.json 的 ${pkg.version} 不一致`);
const lock = JSON.parse(await fs.readFile('package-lock.json', 'utf8'));
if (lock.version !== pkg.version || lock.packages[''].version !== pkg.version) throw new Error('package-lock.json 版本没有同步');
const values = { tag, version: pkg.version, prerelease: String(pkg.version.includes('-')), runtimeKey: `audio-${versions.audioCpp}-llama-${versions.llamaCpp}-2` };
if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''));
console.log(`发布版本：${tag}`);
