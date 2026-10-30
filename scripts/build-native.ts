import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const local = path.join(os.homedir(), '.dotnet', process.platform === 'win32' ? 'dotnet.exe' : 'dotnet');
const dotnet = process.env.DOTNET_HOST_PATH || (existsSync(local) ? local : 'dotnet');
const rid = (process.platform === 'win32' ? 'win' : 'osx') + '-' + (process.arch === 'arm64' ? 'arm64' : 'x64');
const sdk = execFileSync(dotnet, ['--version'], { encoding: 'utf8' }).trim();
if (Number(sdk.split('.')[0]) < 10) throw new Error('原生助手需要 .NET 10 SDK');
const operation = spawn(dotnet, ['publish', 'native/MultiStudio.Native.csproj', '-c', 'Release', '-r', rid, '--self-contained', 'true', '--nologo', '-o', path.resolve('.cache/native-host')], { stdio: 'inherit', windowsHide: true });
operation.once('exit', code => { process.exitCode = code || 0; });
