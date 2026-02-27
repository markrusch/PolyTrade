const fs = require('fs');
const path = require('path');

describe('Agent Instructions Index', () => {
  const workspaceRoot = path.resolve(process.cwd(), '..');
  const indexPath = path.join(workspaceRoot, 'Agent_Instructions', 'profiles', 'index.json');

  test('index.json exists and is valid JSON', () => {
    const text = fs.readFileSync(indexPath, 'utf8');
    const parsed = JSON.parse(text);
    expect(parsed).toHaveProperty('profiles');
    expect(Array.isArray(parsed.profiles)).toBe(true);
  });

  test('all referenced files exist', () => {
    const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    const groups = ['profiles', 'skills', 'instructions', 'workflows', 'templates', 'evaluations'];
    for (const group of groups) {
      const items = parsed[group] || [];
      for (const rel of items) {
        const full = path.join(workspaceRoot, rel);
        expect(fs.existsSync(full)).toBe(true);
      }
    }
  });

  test('profile defines envRequirements', () => {
    const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    const profilePath = path.join(workspaceRoot, parsed.profiles[0]);
    const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    expect(Array.isArray(profile.envRequirements)).toBe(true);
    expect(profile.envRequirements.length).toBeGreaterThan(0);
  });
});
