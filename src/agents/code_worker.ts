import { Agent } from "./agent.js";
import { AgentCapability, AgentType, Task } from "../core/types.js";

export class CodeWorker extends Agent {
  constructor() {
    super(AgentType.CODE_WORKER);
  }

  getCapabilities(): AgentCapability[] {
    return [
      {
        name: "execute_code",
        description: "Executes a block of code and returns the result",
        version: "1.0.0",
        parameters: {
          code: "string",
        },
      },
      {
        name: "lint_code",
        description: "Lints a block of code and returns any errors or warnings",
        version: "1.0.0",
        parameters: {
          code: "string",
        },
      },
      {
        name: "generate_code",
        description:
          "Generates framework-ready starter code from specifications",
        version: "1.0.0",
        parameters: {
          language: "string",
          description: "string",
        },
      },
    ];
  }

  async executeTask(task: Task): Promise<any> {
    const { payload } = task;

    switch (task.type) {
      case "code_generation": {
        const description: string =
          payload.description || payload.spec || "general feature";
        const language: string = (
          payload.language || "typescript"
        ).toLowerCase();
        const generated = this.generateStarterCode(language, description);
        return {
          type: task.type,
          description,
          language,
          generatedCode: generated,
          summary: `Generated ${language} scaffold for: ${description}`,
        };
      }

      case "code_lint":
      case "lint_code": {
        const code: string = payload.code || "";
        const issues = this.performStaticLint(code);
        return {
          type: task.type,
          issues,
          status: issues.length === 0 ? "clean" : "requires_attention",
        };
      }

      case "code_execute":
      case "execute_code": {
        const code: string = payload.code || "";
        return {
          type: task.type,
          executed: code.substring(0, 120),
          output: "Execution simulated for safety",
          notes: "Replace with sandboxed runtime for real execution.",
        };
      }

      default:
        return {
          type: task.type,
          message:
            "CodeWorker received an unknown task type; returning payload for inspection.",
          payload,
        };
    }
  }

  private generateStarterCode(language: string, description: string): string {
    const normalized = description.replace(/\s+/g, " ").trim();
    switch (language) {
      case "python":
        return [
          '"""Auto-generated function stub"""',
          `def handler(event: dict) -> dict:
    """${normalized}"""
    # IMPLEMENT: Add your domain-specific logic here
    raise NotImplementedError("Domain logic implementation required")
    # return {"status": "success", "data": result}`,
        ].join("\n");

      case "javascript":
      case "js":
        return [
          "/** Auto-generated handler */",
          `export async function handler(input) {
  // ${normalized}
  return { status: 'pending', reason: 'implementation required' };
}`,
        ].join("\n");

      case "typescript":
      case "ts":
      default:
        return [
          "/** Auto-generated TypeScript scaffold */",
          `export interface HandlerInput {
  // describe incoming payload shape
}

export interface HandlerResult {
  status: 'pending' | 'complete';
  notes?: string;
}

export async function handler(input: HandlerInput): Promise<HandlerResult> {
  // ${normalized}
  return { status: 'pending', notes: 'implementation required' };
}`,
        ].join("\n");
    }
  }

  private performStaticLint(
    code: string,
  ): Array<{ severity: "info" | "warn" | "error"; message: string }> {
    if (!code.trim()) {
      return [{ severity: "warn", message: "No code supplied for linting." }];
    }

    const issues: Array<{
      severity: "info" | "warn" | "error";
      message: string;
    }> = [];
    if (!/\breturn\b/.test(code)) {
      issues.push({
        severity: "warn",
        message: "Function does not appear to return a value.",
      });
    }
    if (/console\.log/.test(code)) {
      issues.push({
        severity: "info",
        message:
          "Consider removing debug logging (console.log) in production paths.",
      });
    }
    if (code.length > 800) {
      issues.push({
        severity: "info",
        message:
          "Large code block detected; consider refactoring into smaller units.",
      });
    }
    return issues;
  }
}
