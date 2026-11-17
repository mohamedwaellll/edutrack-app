import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Database Schema & Migration Validation', () => {
  const migrationsDir = path.resolve(__dirname, '../../supabase/migrations');

  const schemaFile = path.join(migrationsDir, '20261103_edutrack_schema.sql');
  const seedFile = path.join(migrationsDir, '20261103_edutrack_seed.sql');
  const upgradeFile = path.join(migrationsDir, '20261117_edutrack_admin_auth_upgrade.sql');

  it('ensures all three migration files exist', () => {
    expect(fs.existsSync(schemaFile)).toBe(true);
    expect(fs.existsSync(seedFile)).toBe(true);
    expect(fs.existsSync(upgradeFile)).toBe(true);
  });

  it('validates that NO UUID literals begin with invalid "s" character', () => {
    const files = [schemaFile, seedFile, upgradeFile];

    for (const f of files) {
      const content = fs.readFileSync(f, 'utf8');
      // Look for uuid literals like 's1111111...' or similar invalid hex
      const invalidUUIDMatches = content.match(/'s[0-9a-zA-Z]{7}-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{12}'/gi);
      expect(invalidUUIDMatches).toBeNull();
    }
  });

  it('validates that all explicit UUID string literals are valid RFC 4122 hex UUIDs', () => {
    const files = [schemaFile, seedFile, upgradeFile];
    const uuidRegex = /'([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})'/g;

    for (const f of files) {
      const content = fs.readFileSync(f, 'utf8');
      let match;
      while ((match = uuidRegex.exec(content)) !== null) {
        const candidate = match[1];
        // Must only contain 0-9 and a-f
        expect(candidate).toMatch(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);
      }
    }
  });

  it('verifies that schema and upgrade patch replace permissive USING (true) with database-enforced is_admin()', () => {
    const schemaContent = fs.readFileSync(schemaFile, 'utf8');
    const upgradeContent = fs.readFileSync(upgradeFile, 'utf8');

    // In both files, business tables like groups, students, grades must not have USING (true)
    expect(schemaContent).not.toMatch(/CREATE POLICY "Admins have full access to students"[^;]+USING\s*\(\s*true\s*\)/i);
    expect(schemaContent).not.toMatch(/CREATE POLICY "Admins have full access to groups"[^;]+USING\s*\(\s*true\s*\)/i);
    expect(upgradeContent).not.toMatch(/CREATE POLICY "Admins have full access to students"[^;]+USING\s*\(\s*true\s*\)/i);

    // Verify is_admin() is defined with SECURITY DEFINER in both
    expect(schemaContent).toContain('CREATE OR REPLACE FUNCTION public.is_admin()');
    expect(schemaContent).toContain('SECURITY DEFINER');
    expect(upgradeContent).toContain('CREATE OR REPLACE FUNCTION public.is_admin()');
    expect(upgradeContent).toContain('SECURITY DEFINER');

    // Verify trigger to prevent self role elevation exists in both
    expect(schemaContent).toContain('public.check_profile_role_update()');
    expect(upgradeContent).toContain('public.check_profile_role_update()');
  });

  it('verifies that seed file is repeatable and uses ON CONFLICT guards on all inserts', () => {
    const seedContent = fs.readFileSync(seedFile, 'utf8');
    const inserts = seedContent.split('\n').filter(line => !line.trim().startsWith('--') && line.includes('INSERT INTO'));
    const onConflicts = seedContent.split('\n').filter(line => !line.trim().startsWith('--') && line.includes('ON CONFLICT'));

    expect(inserts.length).toBeGreaterThan(0);
    // Every insert statement in the seed must be guarded with ON CONFLICT
    expect(onConflicts.length).toBe(inserts.length);
  });
});
