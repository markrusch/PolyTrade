#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, '..');

console.log('\n=== GitHub MCP Setup Verification ===\n');

// 1. Check .env file
const envPath = path.join(workspaceRoot, '.env');
console.log('✓ Checking .env file...');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  if (envContent.includes('GITHUB_TOKEN=')) {
    console.log('  ✓ GITHUB_TOKEN found in .env');
  } else {
    console.log('  ✗ GITHUB_TOKEN not found in .env');
  }
} else {
  console.log('  ✗ .env file not found');
}

// 2. Check package.json for MCP server
console.log('\n✓ Checking package.json...');
const pkgPath = path.join(workspaceRoot, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
if (pkg.devDependencies?.['@modelcontextprotocol/server-github']) {
  console.log(
    `  ✓ MCP server installed: ${pkg.devDependencies['@modelcontextprotocol/server-github']}`
  );
} else {
  console.log('  ✗ MCP server not in devDependencies');
}

// 3. Check VS Code settings
console.log('\n✓ Checking VS Code configuration...');
const vscodeSettingsPath = path.join(workspaceRoot, '.vscode', 'settings.json');
if (fs.existsSync(vscodeSettingsPath)) {
  console.log('  ✓ .vscode/settings.json exists');
  const settings = JSON.parse(fs.readFileSync(vscodeSettingsPath, 'utf8'));
  if (settings['github.copilot.enable']) {
    console.log('  ✓ Copilot enabled in VS Code');
  }
} else {
  console.log('  ✗ .vscode/settings.json not found');
}

// 4. Check .gitignore
console.log('\n✓ Checking .gitignore...');
const gitignorePath = path.join(workspaceRoot, '.gitignore');
const gitignore = fs.readFileSync(gitignorePath, 'utf8');
if (gitignore.includes('.env')) {
  console.log('  ✓ .env is gitignored (secrets safe)');
} else {
  console.log('  ✗ .env is NOT gitignored (SECURITY RISK)');
}

// 5. Check node_modules
console.log('\n✓ Checking installation...');
const mcpPath = path.join(workspaceRoot, 'node_modules', '@modelcontextprotocol', 'server-github');
if (fs.existsSync(mcpPath)) {
  console.log('  ✓ MCP server installed in node_modules');
} else {
  console.log('  ✗ MCP server not installed');
}

console.log('\n=== Setup Complete ===\n');
console.log('Next steps:');
console.log('1. Reload VS Code (Cmd/Ctrl+Shift+P → Developer: Reload Window)');
console.log('2. Open Copilot Chat and test: "@github Show me the README.md"');
console.log('3. Verify token permissions: https://github.com/settings/tokens\n');
