/**
 * YAML-first semantic output utilities for codex-synaptic
 * Implements YAML→JSON feedforward filter and schema validation
 */

import * as yaml from 'js-yaml';
import { writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

export interface EndpointCapabilities {
  acceptsYAML: boolean;
  acceptsJSON: boolean;
  contentTypes: string[];
}

export interface ConversionResult {
  content: string;
  contentType: string;
  format: 'yaml' | 'json';
}

export interface YamlValidationError {
  field: string;
  message: string;
  value?: any;
}

export interface YamlSchemaValidationResult {
  valid: boolean;
  errors: YamlValidationError[];
}

/**
 * YAML→JSON feedforward filter implementation
 * Automatically converts YAML to JSON when endpoints don't support YAML
 */
export class YamlFeedforwardFilter {
  /**
   * Apply feedforward conversion based on endpoint capabilities
   */
  static apply(yamlText: string, capabilities: EndpointCapabilities): ConversionResult {
    // If endpoint accepts YAML, return as-is
    if (capabilities.acceptsYAML) {
      return {
        content: yamlText,
        contentType: 'text/yaml',
        format: 'yaml'
      };
    }

    // If endpoint doesn't accept YAML but accepts JSON, convert
    if (capabilities.acceptsJSON) {
      try {
        // Parse YAML with alias expansion
        const parsed = yaml.load(yamlText, {
          // Expand aliases/anchors before conversion
          filename: 'input.yaml'
        });

        // Serialize to JSON with stable key order and indentation
        const jsonText = JSON.stringify(parsed, null, 2);

        return {
          content: jsonText,
          contentType: 'application/json',
          format: 'json'
        };
      } catch (error) {
        throw new Error(`YAML_PARSE_ERROR: ${error instanceof Error ? error.message : 'Unknown parsing error'}`);
      }
    }

    throw new Error('UNSUPPORTED_ENDPOINT: Endpoint supports neither YAML nor JSON');
  }

  /**
   * Detect endpoint capabilities from headers or metadata
   */
  static detectCapabilities(
    acceptHeader?: string,
    contentTypes?: string[],
    _metadata?: Record<string, any>
  ): EndpointCapabilities {
    const allContentTypes = [
      ...(acceptHeader ? acceptHeader.split(',').map(t => t.trim()) : []),
      ...(contentTypes || [])
    ];

    return {
      acceptsYAML: allContentTypes.some(type => 
        type.includes('yaml') || type.includes('yml') || type.includes('text/yaml')
      ),
      acceptsJSON: allContentTypes.some(type => 
        type.includes('json') || type.includes('application/json')
      ),
      contentTypes: allContentTypes
    };
  }

  /**
   * Validate YAML content against expected structure
   */
  static validateYamlStructure(yamlText: string): YamlSchemaValidationResult {
    const errors: YamlValidationError[] = [];

    try {
      const parsed = yaml.load(yamlText) as any;

      if (!parsed || typeof parsed !== 'object') {
        errors.push({
          field: 'root',
          message: 'YAML must contain a valid object structure'
        });
        return { valid: false, errors };
      }

      // Validate required top-level fields for codex-synaptic schema
      const requiredFields = ['version', 'meta', 'summary'];
      for (const field of requiredFields) {
        if (!(field in parsed)) {
          errors.push({
            field,
            message: `Required field '${field}' is missing`
          });
        }
      }

      // Validate meta structure
      if (parsed.meta && typeof parsed.meta === 'object') {
        const requiredMetaFields = ['issue_id', 'spec_version', 'generated_at'];
        for (const field of requiredMetaFields) {
          if (!(field in parsed.meta)) {
            errors.push({
              field: `meta.${field}`,
              message: `Required meta field '${field}' is missing`
            });
          }
        }
      }

      // Check for reserved YAML tokens that might cause ambiguity
      const yamlReservedTokens = ['yes', 'no', 'on', 'off', 'true', 'false'];
      const checkForReservedTokens = (obj: any, path: string = '') => {
        if (typeof obj === 'string' && yamlReservedTokens.includes(obj.toLowerCase())) {
          errors.push({
            field: path,
            message: `Value '${obj}' should be quoted to avoid YAML interpretation ambiguity`,
            value: obj
          });
        } else if (typeof obj === 'object' && obj !== null) {
          Object.entries(obj).forEach(([key, value]) => {
            checkForReservedTokens(value, path ? `${path}.${key}` : key);
          });
        }
      };

      checkForReservedTokens(parsed);

    } catch (error) {
      errors.push({
        field: 'parse',
        message: `YAML parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

/**
 * YAML schema utilities for codex-synaptic improvement plans
 */
export class YamlSchemaUtils {
  private static schemaPath = join(process.cwd(), '.codex-improvement', 'SCHEMA_MASTER.yaml');

  /**
   * Load the master YAML schema
   */
  static async loadMasterSchema(): Promise<any> {
    if (!existsSync(this.schemaPath)) {
      throw new Error(`Master schema not found at ${this.schemaPath}`);
    }

    const schemaContent = await readFile(this.schemaPath, 'utf-8');
    return yaml.load(schemaContent);
  }

  /**
   * Validate and replace schema placeholders
   */
  static validateAndReplacePlaceholders(data: any, context: string = 'root'): any {
    if (typeof data === 'string') {
      // Check for placeholder patterns like <ISO8601>, <text>, etc.
      const placeholderMatch = data.match(/^<(.+)>$/);
      if (placeholderMatch) {
        const placeholderType = placeholderMatch[1];
        console.warn(`Warning: Placeholder '${data}' found at ${context}. This should be replaced with actual content.`);
        
        // Provide reasonable defaults for common placeholders
        switch (placeholderType) {
          case 'ISO8601':
            return new Date().toISOString();
          case 'string':
            return `[PLACEHOLDER: ${context}]`;
          case 'text':
            return `[PLACEHOLDER: Replace with actual text for ${context}]`;
          default:
            if (placeholderType.includes('≤') && placeholderType.includes('word')) {
              return `[PLACEHOLDER: ${placeholderType} - Replace with actual content]`;
            }
            return data; // Keep original if we don't have a specific handler
        }
      }
      return data;
    } else if (Array.isArray(data)) {
      return data.map((item, index) => 
        this.validateAndReplacePlaceholders(item, `${context}[${index}]`)
      );
    } else if (typeof data === 'object' && data !== null) {
      const result: any = {};
      for (const [key, value] of Object.entries(data)) {
        result[key] = this.validateAndReplacePlaceholders(value, `${context}.${key}`);
      }
      return result;
    }
    
    return data;
  }

  /**
   * Generate a YAML document conforming to the master schema
   */
  static generateFromSchema(data: any): string {
    // Apply YAML generation options for better LLM compatibility
    const yamlOptions: yaml.DumpOptions = {
      // Use 2-space indentation for clarity
      indent: 2,
      // Preserve line width for readability
      lineWidth: 120,
      // Use block literals for multi-line strings
      styles: {
        '!!str': 'literal'
      },
      // Sort keys for consistency
      sortKeys: true,
      // Avoid refs/anchors in output (expand all)
      noRefs: true,
      // Use explicit typing when needed
      skipInvalid: false
    };

    return yaml.dump(data, yamlOptions);
  }

  /**
   * Create a populated improvement plan YAML
   */
  static async createImprovementPlan(overrides: Partial<any> = {}): Promise<string> {
    const masterSchema = await this.loadMasterSchema();
    
    // Apply current timestamp and validate placeholders
    const now = new Date().toISOString();
    
    let populatedPlan = {
      ...masterSchema,
      meta: {
        ...masterSchema.meta,
        generated_at: now
      },
      assumptions: [
        "YAML-first output provides better structural adherence for LLM-generated content",
        "Modular architecture will improve maintainability and testing",
        "TypeScript↔Python bridge enables hybrid system capabilities",
        "Consensus mechanisms ensure system reliability and fault tolerance",
        "Comprehensive telemetry enables effective monitoring and debugging"
      ],
      summary: {
        problem: "Implement a structured self-improvement program for codex-synaptic using YAML-first semantic output to guide agentic orchestration, focusing on modular architecture, enhanced swarm/consensus capabilities, and comprehensive system evolution.",
        objectives_ordered: masterSchema.summary.objectives_ordered
      },
      gap_analysis: [
        {
          focus: "Architecture",
          current: "Monolithic CodexSynapticSystem handling all orchestration, mesh, swarm, and consensus functionality",
          target: "Modular architecture with clear boundaries: core.orchestrator, mesh.topology, swarm.engine, consensus.manager, memory.bridge, telemetry.bus, security.guard"
        },
        {
          focus: "Swarm/Consensus", 
          current: "Basic PSO implementation with simple consensus mechanisms",
          target: "Enhanced algorithms with adaptive parameters, multiple optimization strategies, and robust Byzantine fault tolerance"
        },
        {
          focus: "Memory Bridge",
          current: "Separate TypeScript SQLite and Python ChromaDB systems without integration",
          target: "Unified memory bridge with bi-directional sync, semantic queries, and conflict resolution"
        },
        {
          focus: "Testing",
          current: "Basic unit tests with 47 passing tests",
          target: "Comprehensive test strategy with >75% coverage, integration tests, performance tests, and security validation"
        },
        {
          focus: "Telemetry",
          current: "Limited logging and basic health monitoring",
          target: "Structured telemetry with events, metrics, dashboards, and alerting for comprehensive observability"
        }
      ],
      ...overrides
    };

    // Validate and replace any remaining placeholders
    populatedPlan = this.validateAndReplacePlaceholders(populatedPlan, 'improvement_plan');

    return this.generateFromSchema(populatedPlan);
  }

  /**
   * Validate and save YAML content to file
   */
  static async saveYamlDocument(
    filePath: string, 
    content: string, 
    validate: boolean = true
  ): Promise<void> {
    if (validate) {
      const validation = YamlFeedforwardFilter.validateYamlStructure(content);
      if (!validation.valid) {
        throw new Error(`YAML validation failed: ${validation.errors.map(e => e.message).join(', ')}`);
      }
    }

    await writeFile(filePath, content, 'utf-8');
  }
}

/**
 * Output formatter for hive-mind results
 */
export class HiveMindYamlFormatter {
  /**
   * Format hive-mind execution results as YAML
   */
  static formatExecutionResult(result: any): string {
    const formattedResult = {
      version: 1,
      meta: {
        execution_id: result.executionId || 'unknown',
        timestamp: new Date().toISOString(),
        system_version: result.systemVersion || '1.0.0'
      },
      execution: {
        status: result.status || 'completed',
        duration_ms: result.duration || 0,
        prompt: result.originalPrompt || '',
        context_enabled: Boolean(result.codexContext)
      },
      results: {
        summary: result.summary || 'Task completed successfully',
        artifacts: result.artifacts || {},
        tot_plan: result.totPlan || null,
        performance: {
          agents_deployed: result.agentCount || 0,
          tasks_completed: result.taskCount || 0,
          mesh_nodes: result.meshStatus?.nodeCount || 0,
          consensus_decisions: result.consensusStatus?.totalVotes || 0
        }
      },
      system_state: {
        mesh: result.mesh || {},
        swarm: result.swarm || {},
        consensus: result.consensus || {}
      }
    };

    return YamlSchemaUtils.generateFromSchema(formattedResult);
  }

  /**
   * Format system status as YAML
   */
  static formatSystemStatus(status: any): string {
    const formattedStatus = {
      version: 1,
      meta: {
        timestamp: new Date().toISOString(),
        system_id: status.systemId || 'codex-synaptic-instance'
      },
      system: {
        status: status.ready ? 'ready' : 'initializing',
        uptime_ms: status.uptime || 0,
        agents: {
          total: status.agents?.total || 0,
          active: status.agents?.active || 0,
          by_type: status.agents?.byType || {}
        },
        resources: {
          memory_mb: status.resources?.memoryUsage || 0,
          cpu_percent: status.resources?.cpuUsage || 0
        }
      },
      components: {
        mesh: {
          status: status.mesh?.status || 'offline',
          nodes: status.mesh?.nodeCount || 0,
          connections: status.mesh?.connectionCount || 0
        },
        swarm: {
          status: status.swarm?.status || 'offline',
          algorithm: status.swarm?.algorithm || 'none',
          optimizing: status.swarm?.isOptimizing || false
        },
        consensus: {
          status: status.consensus?.status || 'offline',
          active_proposals: status.consensus?.activeProposals || 0
        }
      }
    };

    return YamlSchemaUtils.generateFromSchema(formattedStatus);
  }
}
