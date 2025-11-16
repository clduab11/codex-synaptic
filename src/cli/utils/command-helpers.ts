/**
 * Command helper utilities for CLI command registration and handling
 */

import chalk from "chalk";
import type { Command } from "commander";

/**
 * Options for decorating command help text
 */
export interface CommandHelpDecorOptions {
  /**
   * Whether to show experimental warning
   */
  experimental?: boolean;

  /**
   * Examples to show in help text
   */
  examples?: string[];

  /**
   * Additional notes or warnings
   */
  notes?: string[];
}

/**
 * Decorates a command with enhanced help text
 * @param command - Commander command instance
 * @param options - Decoration options
 * @returns Decorated command
 */
export function decorateCommandHelp(
  command: Command,
  options: CommandHelpDecorOptions,
): Command {
  const { experimental, examples, notes } = options;

  if (experimental) {
    command.addHelpText(
      "after",
      `\n${chalk.yellow("⚠️  EXPERIMENTAL")}: This command is under active development.\n`,
    );
  }

  if (examples && examples.length > 0) {
    const examplesText = examples
      .map((ex) => `  ${chalk.cyan("$")} ${ex}`)
      .join("\n");
    command.addHelpText(
      "after",
      `\n${chalk.bold("Examples:")}\n${examplesText}\n`,
    );
  }

  if (notes && notes.length > 0) {
    const notesText = notes.map((note) => `  • ${note}`).join("\n");
    command.addHelpText("after", `\n${chalk.bold("Notes:")}\n${notesText}\n`);
  }

  return command;
}

/**
 * Wraps a command handler with error handling and logging
 * @param name - Command name for logging
 * @param fn - Handler function
 * @returns Wrapped handler function
 */
export function handleCommand<T extends any[]>(
  name: string,
  fn: (...args: T) => Promise<void>,
): (...args: T) => Promise<void> {
  return async (...args: T): Promise<void> => {
    try {
      await fn(...args);
    } catch (error: any) {
      console.error(
        chalk.red(`Error executing command '${name}':`),
        error.message,
      );
      if (error.stack) {
        console.error(chalk.gray(error.stack));
      }
      process.exit(1);
    }
  };
}

/**
 * Checks if a prompt should auto-attach Codex context
 * @param prompt - User prompt string
 * @returns true if context should be attached
 */
export function shouldAutoAttachCodexContext(prompt: string): boolean {
  const lowerPrompt = prompt.toLowerCase();

  // Auto-attach for repository-related queries
  const repoKeywords = [
    "repository",
    "codebase",
    "project structure",
    "architecture",
    "how does",
    "where is",
    "find",
    "locate",
    "explain this code",
    "refactor",
    "improve",
    "agents.md",
    "readme",
  ];

  return repoKeywords.some((keyword) => lowerPrompt.includes(keyword));
}

/**
 * Checks if a prompt should require consensus based on keywords
 * @param prompt - User prompt string
 * @param consensusMode - Current consensus mode
 * @returns true if consensus should be required
 */
export function shouldRequireConsensus(
  prompt: string,
  consensusMode: string,
): boolean {
  if (consensusMode === "off") {
    return false;
  }

  const lowerPrompt = prompt.toLowerCase();
  const criticalKeywords = [
    "delete",
    "remove",
    "destroy",
    "shutdown",
    "terminate",
    "kill",
    "drop",
    "critical",
    "production",
  ];

  return criticalKeywords.some((keyword) => lowerPrompt.includes(keyword));
}

/**
 * Derives a boolean decision from consensus outcome
 * @param outcome - Consensus outcome object
 * @returns true if consensus accepted, false otherwise
 */
export function deriveConsensusDecision(outcome: any): boolean {
  if (!outcome) {
    return false;
  }

  if (typeof outcome.accepted === "boolean") {
    return outcome.accepted;
  }

  if (typeof outcome.approved === "boolean") {
    return outcome.approved;
  }

  // Fallback: check vote ratio
  if (
    typeof outcome.yesVotes === "number" &&
    typeof outcome.totalVotes === "number"
  ) {
    return outcome.yesVotes > outcome.totalVotes / 2;
  }

  return false;
}
