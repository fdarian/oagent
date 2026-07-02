import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const version = process.env.VERSION;
if (!version) {
	throw new Error('Missing VERSION environment variable');
}

const token = process.env.HOMEBREW_TAP_TOKEN;
if (!token) {
	throw new Error('Missing HOMEBREW_TAP_TOKEN environment variable');
}

const packageJson = JSON.parse(
	fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as {
	description: string;
};

const targets = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64'];

function sha256For(label: string): string {
	const filePath = path.join('dist', 'releases', `oagent-${label}.tar.gz`);
	const file = fs.readFileSync(filePath);
	return new Bun.CryptoHasher('sha256').update(file).digest('hex');
}

const shas = new Map<string, string>();
for (const target of targets) {
	shas.set(target, sha256For(target));
}

const formula = `class Oagent < Formula
  desc ${JSON.stringify(packageJson.description)}
  homepage "https://github.com/fdarian/oagent"
  version ${JSON.stringify(version)}

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/fdarian/oagent/releases/download/oagent%40${version}/oagent-darwin-arm64.tar.gz"
      sha256 ${JSON.stringify(shas.get('darwin-arm64'))}
    else
      url "https://github.com/fdarian/oagent/releases/download/oagent%40${version}/oagent-darwin-x64.tar.gz"
      sha256 ${JSON.stringify(shas.get('darwin-x64'))}
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/fdarian/oagent/releases/download/oagent%40${version}/oagent-linux-arm64.tar.gz"
      sha256 ${JSON.stringify(shas.get('linux-arm64'))}
    else
      url "https://github.com/fdarian/oagent/releases/download/oagent%40${version}/oagent-linux-x64.tar.gz"
      sha256 ${JSON.stringify(shas.get('linux-x64'))}
    end
  end

  def install
    bin.install "oagent"
  end
end
`;

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oagent-homebrew-'));

try {
	const cloneUrl = `https://x-access-token:${token}@github.com/fdarian/homebrew-tap`;
	const cloneResult = Bun.spawnSync(['git', 'clone', cloneUrl, tempDir]);
	if (cloneResult.exitCode !== 0) {
		throw new Error(`git clone failed\n${cloneResult.stderr.toString()}`);
	}

	const formulaDir = path.join(tempDir, 'Formula');
	fs.mkdirSync(formulaDir, { recursive: true });
	fs.writeFileSync(path.join(formulaDir, 'oagent.rb'), formula, 'utf8');

	const nameResult = Bun.spawnSync(
		['git', 'config', 'user.name', 'github-actions[bot]'],
		{
			cwd: tempDir,
		},
	);
	if (nameResult.exitCode !== 0) {
		throw new Error(
			`git config user.name failed\n${nameResult.stderr.toString()}`,
		);
	}

	const emailResult = Bun.spawnSync(
		[
			'git',
			'config',
			'user.email',
			'41898282+github-actions[bot]@users.noreply.github.com',
		],
		{ cwd: tempDir },
	);
	if (emailResult.exitCode !== 0) {
		throw new Error(
			`git config user.email failed\n${emailResult.stderr.toString()}`,
		);
	}

	const addResult = Bun.spawnSync(['git', 'add', 'Formula/oagent.rb'], {
		cwd: tempDir,
	});
	if (addResult.exitCode !== 0) {
		throw new Error(`git add failed\n${addResult.stderr.toString()}`);
	}

	const commitResult = Bun.spawnSync(
		['git', 'commit', '-m', `Update oagent formula for ${version}`],
		{
			cwd: tempDir,
		},
	);
	if (commitResult.exitCode !== 0) {
		throw new Error(`git commit failed\n${commitResult.stderr.toString()}`);
	}

	const pushResult = Bun.spawnSync(['git', 'push'], { cwd: tempDir });
	if (pushResult.exitCode !== 0) {
		throw new Error(`git push failed\n${pushResult.stderr.toString()}`);
	}
} finally {
	fs.rmSync(tempDir, { recursive: true, force: true });
}
