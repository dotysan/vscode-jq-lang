import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

for (const filename of [
  'package.json',
  'language-configuration.json',
  'syntaxes/jq.tmLanguage.json'
]) {
  JSON.parse(readFileSync(filename, 'utf8'));
  console.log(`JSON OK: ${filename}`);
}

try {
  const version = execFileSync('jq', ['--version'], { encoding: 'utf8' }).trim();
  execFileSync('jq', ['--null-input', '--from-file', 'test/fixtures/tail.jq'], {
    stdio: ['ignore', 'ignore', 'pipe'],
    timeout: 2000
  });
  console.log('jq OK: test/fixtures/tail.jq');

  const match = /^jq-(\d+)\.(\d+)/.exec(version);
  const supports18 = match !== null && (Number(match[1]) > 1 || Number(match[2]) >= 8);
  if (supports18) {
    execFileSync('jq', ['--null-input', '--from-file', 'test/fixtures/modern-syntax.jq'], {
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: 2000
    });
    console.log('jq OK: test/fixtures/modern-syntax.jq');
  } else {
    console.log(`jq SKIP (${version}): jq 1.8 fixture`);
  }
} catch (error) {
  const stderr = error?.stderr?.toString() ?? error?.message ?? String(error);
  console.error(stderr);
  process.exitCode = 1;
}

const jq17Error = `jq: error: foo/0 is not defined at <top-level>, line 1:
foo
jq: 1 compile error`;
const jq18Error = `jq: error: foo/0 is not defined at <top-level>, line 1, column 1:
    foo
    ^^^
jq: 1 compile error`;
const locationPattern = /^jq: error:\s*(.*?)\s+at <top-level>, line (\d+)(?:, column (\d+))?:\s*$/;
for (const sample of [jq17Error, jq18Error]) {
  const firstLine = sample.split(/\r?\n/)[0];
  if (locationPattern.exec(firstLine) === null) {
    throw new Error(`Diagnostic parser rejected: ${firstLine}`);
  }
}
console.log('Diagnostic format smoke test OK');
