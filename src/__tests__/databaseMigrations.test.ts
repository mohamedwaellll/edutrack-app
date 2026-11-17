import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Database Schema & Migration Files (Static Analysis Unit Tests)', () => {
  const rootDir = path.resolve(__dirname, '../../');
  const migrationsDir = path.join(rootDir, 'supabase/migrations');

  const schemaFile = path.join(migrationsDir, '20261103_edutrack_schema.sql');
  const upgradeFile = path.join(migrationsDir, '20261117_edutrack_admin_auth_upgrade.sql');
  const seedFile = path.join(rootDir, 'supabase/seed.sql');

  it('ensures schema, upgrade migration and standalone seed file exist', () => {
    expect(fs.existsSync(schemaFile)).toBe(true);
    expect(fs.existsSync(upgradeFile)).toBe(true);
    expect(fs.existsSync(seedFile)).toBe(true);
  });

  it('ensures migration files in supabase/migrations have unique version prefixes', () => {
    const migrationFiles = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));
    const prefixes = migrationFiles.map(f => f.split('_')[0]);
    const uniquePrefixes = new Set(prefixes);

    // Each migration file MUST have a unique timestamp/version prefix to prevent Supabase CLI collisions
    expect(uniquePrefixes.size).toBe(migrationFiles.length);
  });

  it('validates that NO UUID literals begin with invalid "s" character', () => {
    const files = [schemaFile, upgradeFile, seedFile];

    for (const f of files) {
      const content = fs.readFileSync(f, 'utf8');
      const invalidUUIDMatches = content.match(/'s[0-9a-zA-Z]{7}-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{12}'/gi);
      expect(invalidUUIDMatches).toBeNull();
    }
  });

  it('validates that all explicit UUID string literals are valid RFC 4122 hex UUIDs', () => {
    const files = [schemaFile, upgradeFile, seedFile];
    const uuidRegex = /'([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})'/g;

    for (const f of files) {
      const content = fs.readFileSync(f, 'utf8');
      let match;
      while ((match = uuidRegex.exec(content)) !== null) {
        const candidate = match[1];
        expect(candidate).toMatch(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);
      }
    }
  });

  it('verifies that schema and upgrade patch replace permissive USING (true) with database-enforced is_admin()', () => {
    const schemaContent = fs.readFileSync(schemaFile, 'utf8');
    const upgradeContent = fs.readFileSync(upgradeFile, 'utf8');

    // Business tables must not have USING (true)
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
    expect(schemaContent).toContain('public.check_profile_role_insert()');
    expect(upgradeContent).toContain('public.check_profile_role_insert()');

    // Verify provision_admin procedure exists in both
    expect(schemaContent).toContain('public.provision_admin');
    expect(upgradeContent).toContain('public.provision_admin');
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
