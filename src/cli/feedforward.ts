import chalk from 'chalk';
import { readFileSync } from 'node:fs';
import * as yaml from 'js-yaml';
import { YamlFeedforwardFilter, type EndpointCapabilities, type ConversionResult } from '../utils/yaml-output.js';

const DEFAULT_CLI_CAPABILITIES: EndpointCapabilities = {
  acceptsYAML: false,
  acceptsJSON: true,
  contentTypes: ['application/json']
};

const YAML_DUMP_OPTIONS: yaml.DumpOptions = {
  indent: 2,
  lineWidth: 120,
  sortKeys: true,
  noRefs: true
};

export interface FeedforwardNormalizedResult<T = any> {
  data: T;
  conversion: ConversionResult;
  toJson(): string;
  toYaml(): string;
}

export function normalizeWithFeedforward(
  yamlSource: string,
  label: string,
  capabilities: EndpointCapabilities = DEFAULT_CLI_CAPABILITIES
): FeedforwardNormalizedResult {
  try {
    const conversion = YamlFeedforwardFilter.apply(yamlSource, capabilities);
    const normalizedData = conversion.format === 'json'
      ? JSON.parse(conversion.content)
      : (yaml.load(conversion.content) as any);

    console.log(
      chalk.gray(`🔁 YamlFeedforwardFilter normalized ${label} (${conversion.format.toUpperCase()})`)
    );

    return {
      data: normalizedData,
      conversion,
      toJson: () => conversion.format === 'json'
        ? conversion.content
        : JSON.stringify(normalizedData, null, 2),
      toYaml: () => conversion.format === 'yaml'
        ? conversion.content
        : yaml.dump(normalizedData, YAML_DUMP_OPTIONS)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to normalize ${label} via YamlFeedforwardFilter: ${message}`);
  }
}

export function parseJsonInput(
  value: string,
  label: string,
  capabilities: EndpointCapabilities = DEFAULT_CLI_CAPABILITIES
): any {
  try {
    const parsed = JSON.parse(value);
    const yamlSource = yaml.dump(parsed, YAML_DUMP_OPTIONS);
    return normalizeWithFeedforward(yamlSource, `${label} JSON input`, capabilities).data;
  } catch (error) {
    throw new Error(`${label} must be valid JSON${error instanceof Error ? `: ${error.message}` : ''}`);
  }
}

export function loadFileThroughFeedforward(
  filePath: string,
  capabilities: EndpointCapabilities = DEFAULT_CLI_CAPABILITIES
): FeedforwardNormalizedResult {
  const content = readFileSync(filePath, 'utf8');
  const isYaml = filePath.endsWith('.yaml') || filePath.endsWith('.yml');

  if (isYaml) {
    return normalizeWithFeedforward(content, filePath, capabilities);
  }

  try {
    const parsedJson = JSON.parse(content);
    const yamlSource = yaml.dump(parsedJson, YAML_DUMP_OPTIONS);
    return normalizeWithFeedforward(yamlSource, filePath, capabilities);
  } catch (error) {
    throw new Error(`Failed to parse JSON file ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Parse file content supporting both YAML and JSON formats
 * Returns the normalized object while preserving helpers for JSON/YAML emission
 */
export function parseFileContent(
  filePath: string,
  capabilities: EndpointCapabilities = DEFAULT_CLI_CAPABILITIES
): any {
  return loadFileThroughFeedforward(filePath, capabilities).data;
}

export { DEFAULT_CLI_CAPABILITIES as DEFAULT_FEEDFORWARD_CAPABILITIES };
