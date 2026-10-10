import { defineMessages } from '../../platform/nls';

export const t = defineMessages('setup', {
  pageLabel: 'Getting started',
  welcome: 'Welcome to Vilausity',
  intro: 'Vilausity runs Claude Code, the extension Anthropic publishes on Open VSX. Two steps, and you can start.',
  installStep: 'Install the Claude Code extension',
  installText: 'About 120 MB, from {0}.',
  download: 'Download and Install',
  installFile: 'Install from VSIX...',
  changeServer: 'Download from another server',
  installed: 'Claude Code {0} is installed.',
  starting: 'Claude Code {0} is installed. Starting it...',
  connectStep: 'Connect to Claude',
  account: 'Sign in with a Claude account',
  accountText: 'Claude Pro or Max. The sign-in shows in the conversation.',
  provider: 'Use an API provider',
  providerText: 'An Anthropic API key, or DeepSeek, Kimi, GLM, Qwen and others. You can switch any time in the title bar.',
  later: 'Decide later',
  gitMissing:
    'Git for Windows was not found. Claude Code uses Git to track changes and Git Bash to run commands; without it, Claude runs commands in PowerShell.',
  downloadGit: 'Download Git for Windows',
  dontShowAgain: "Don't Show Again",
});
