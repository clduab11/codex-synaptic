import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadFileThroughFeedforward, parseFileContent } from '../../src/cli/feedforward.js';

const EXPECTED_SAMPLE = {
  version: 1,
  meta: {
    issue_id: 'COD-42',
    spec_version: 'v1',
    generated_at: '2024-01-01T00:00:00.000Z'
  },
  summary: 'Example summary for feedforward tests.'
};

describe('Feedforward normalization helpers', () => {
  let tempDir: string;
  let yamlPath: string;
  let jsonPath: string;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'codex-feedforward-'));
    yamlPath = join(tempDir, 'sample.yaml');
    jsonPath = join(tempDir, 'sample.json');

    const yamlContent = `version: ${EXPECTED_SAMPLE.version}\n` +
      'meta:\n' +
      `  issue_id: ${EXPECTED_SAMPLE.meta.issue_id}\n` +
      `  spec_version: ${EXPECTED_SAMPLE.meta.spec_version}\n` +
  `  generated_at: ${EXPECTED_SAMPLE.meta.generated_at}\n` +
      `summary: ${EXPECTED_SAMPLE.summary}`;

    writeFileSync(yamlPath, yamlContent);
    writeFileSync(jsonPath, JSON.stringify(EXPECTED_SAMPLE, null, 2));
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('normalizes YAML files to JSON-aware results', () => {
    const result = loadFileThroughFeedforward(yamlPath);

    expect(result.conversion.format).toBe('json');
    expect(result.conversion.contentType).toBe('application/json');
    expect(result.data).toMatchObject(EXPECTED_SAMPLE);
    expect(JSON.parse(result.toJson())).toMatchObject(EXPECTED_SAMPLE);
    expect(result.toYaml()).toContain('summary:');
  });

  it('normalizes JSON files via YAML-first pipeline', () => {
    const result = loadFileThroughFeedforward(jsonPath);

    expect(result.conversion.format).toBe('json');
    expect(JSON.parse(result.toJson())).toMatchObject(EXPECTED_SAMPLE);
    expect(result.data).toMatchObject(EXPECTED_SAMPLE);
  });

  it('returns parsed objects from parseFileContent', () => {
    const parsed = parseFileContent(yamlPath);
    expect(parsed).toMatchObject(EXPECTED_SAMPLE);
  });
});
