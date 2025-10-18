import { MCPTool } from './types.js';
import { SwarmInitTool } from './tools/swarm-init.js';
import { FilesystemWriteTool } from './tools/filesystem-write.js';

export class CodexMCPServer {
  private tools: Map<string, MCPTool> = new Map();

  async initialize() {
    // Register all tools
    this.registerSwarmTools();
    this.registerFilesystemTools();
    // Additional registration placeholders
  }

  private registerSwarmTools() {
    this.tools.set('swarm_init', new SwarmInitTool());
    // ... register remaining tools
  }

  private registerFilesystemTools() {
    this.tools.set('filesystem_write_asset', new FilesystemWriteTool());
  }
}
