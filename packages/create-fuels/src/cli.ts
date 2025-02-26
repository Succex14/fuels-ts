import toml from '@iarna/toml';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { Command } from 'commander';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { cp, mkdir, rename } from 'fs/promises';
import { join } from 'path';
import prompts from 'prompts';

import packageJson from '../package.json';

const log = (...data: unknown[]) => {
  process.stdout.write(`${data.join(' ')}\n`);
};

type ProgramsToInclude = {
  contract: boolean;
  predicate: boolean;
  script: boolean;
};

const processWorkspaceToml = (fileContents: string, programsToInclude: ProgramsToInclude) => {
  const parsed = toml.parse(fileContents) as {
    workspace: {
      members: ('predicate' | 'contract' | 'script')[];
    };
  };

  parsed.workspace.members = parsed.workspace.members.filter((m) => programsToInclude[m]);

  return toml.stringify(parsed);
};

async function promptForProjectPath() {
  const res = await prompts({
    type: 'text',
    name: 'projectName',
    message: 'What is the name of your project?',
    initial: 'my-fuel-project',
  });

  return res.projectName as string;
}

async function promptForPackageManager() {
  const packageManagerInput = await prompts({
    type: 'select',
    name: 'packageManager',
    message: 'Select a package manager',
    choices: [
      { title: 'pnpm', value: 'pnpm' },
      { title: 'npm', value: 'npm' },
    ],
    initial: 0,
  });
  return packageManagerInput.packageManager as string;
}

async function promptForProgramsToInclude() {
  const programsToIncludeInput = await prompts({
    type: 'multiselect',
    name: 'programsToInclude',
    message: 'Which Sway programs do you want?',
    choices: [
      { title: 'Contract', value: 'contract', selected: true },
      { title: 'Predicate', value: 'predicate' },
      { title: 'Script', value: 'script' },
    ],
    instructions: false,
  });
  return {
    contract: programsToIncludeInput.programsToInclude.includes('contract'),
    predicate: programsToIncludeInput.programsToInclude.includes('predicate'),
    script: programsToIncludeInput.programsToInclude.includes('script'),
  };
}

function writeEnvFile(envFilePath: string, programsToInclude: ProgramsToInclude) {
  /*
   * Should be like:
   * NEXT_PUBLIC_HAS_CONTRACT=true
   * NEXT_PUBLIC_HAS_PREDICATE=false
   * NEXT_PUBLIC_HAS_SCRIPT=true
   */
  const newFileContents = Object.entries(programsToInclude)
    .map(([program, include]) => `NEXT_PUBLIC_HAS_${program.toUpperCase()}=${include}`)
    .join('\n');
  writeFileSync(envFilePath, newFileContents);
}

export const runScaffoldCli = async (
  explicitProjectPath?: string,
  explicitPackageManger?: string,
  shouldInstallDeps = true,
  explicitProgramsToInclude?: ProgramsToInclude
) => {
  new Command(packageJson.name).version(packageJson.version);

  const projectPath = explicitProjectPath || (await promptForProjectPath());
  if (existsSync(projectPath)) {
    throw new Error(
      `A folder already exists at ${projectPath}. Please choose a different project name.`
    );
  }

  if (!projectPath) {
    throw new Error('Please specify a project directory.');
  }
  const packageManager = explicitPackageManger || (await promptForPackageManager());

  const programsToInclude: ProgramsToInclude =
    explicitProgramsToInclude || (await promptForProgramsToInclude());

  if (!programsToInclude.contract && !programsToInclude.predicate && !programsToInclude.script) {
    throw new Error('You must include at least one Sway program.');
  }

  await mkdir(projectPath);

  await cp(join(__dirname, '../templates/nextjs'), projectPath, { recursive: true });
  await rename(join(projectPath, 'gitignore'), join(projectPath, '.gitignore'));
  await rename(join(projectPath, 'env'), join(projectPath, '.env.local'));
  writeEnvFile(join(projectPath, '.env.local'), programsToInclude);

  // delete the programs that are not to be included
  if (!programsToInclude.contract) {
    rmSync(join(projectPath, 'sway-programs/contract'), { recursive: true });
  }
  if (!programsToInclude.predicate) {
    rmSync(join(projectPath, 'sway-programs/predicate'), { recursive: true });
    rmSync(join(projectPath, 'src/pages/predicate.tsx'), { recursive: true });
  }
  if (!programsToInclude.script) {
    rmSync(join(projectPath, 'sway-programs/script'), { recursive: true });
    rmSync(join(projectPath, 'src/pages/script.tsx'), { recursive: true });
  }

  // remove the programs that are not included from the Forc.toml members field and rewrite the file
  const forcTomlPath = join(projectPath, 'sway-programs', 'Forc.toml');
  const forcTomlContents = readFileSync(forcTomlPath, 'utf-8');
  const newForcTomlContents = processWorkspaceToml(forcTomlContents, programsToInclude);
  writeFileSync(forcTomlPath, newForcTomlContents);

  if (shouldInstallDeps) {
    process.chdir(projectPath);
    execSync(`${packageManager} install`, { stdio: 'inherit' });
  }

  log();
  log();
  log(chalk.green(`⚡️ Success! Created a fullstack Fuel dapp at ${projectPath}`));
  log();
  log();
  log('To get started:');
  log();
  log(`- cd into the project directory: cd ${projectPath}`);
  log(
    `- Start a local Fuel dev server: ${packageManager} ${
      packageManager === 'npm' ? 'run ' : ''
    }fuels:dev`
  );
  log(`- Run the frontend: ${packageManager} ${packageManager === 'npm' ? 'run ' : ''}dev`);
  log();
  log();
  log('-> TS SDK docs: https://docs.fuel.network/docs/fuels-ts/');
  log('-> Sway docs: https://docs.fuel.network/docs/sway/');
  log('-> If you have any questions, check the Fuel forum: https://forum.fuel.network/');
  log();
  log();
};
