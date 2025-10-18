# Interactive Mode Enhancements

## Overview

The Codex-Synaptic interactive mode has been significantly enhanced to provide a comprehensive command hub that maintains the orchestrator system in a single shell session, eliminating the need for multiple terminal panes.

## Key Features

### 1. Dashboard-Driven Interface
- **System Dashboard**: Displays comprehensive system status on entry including:
  - System readiness and uptime
  - Agent registry statistics
  - Neural mesh topology and health
  - Swarm coordination status
  - Consensus mechanism state

### 2. Enhanced Main Menu
The interactive mode now provides **11 menu options** organized into logical categories:

#### Core Workflows (7 Submenus)
1. **System dashboard & controls** → `interactiveSystemMenu()`
   - System information
   - Resource limits
   - Configuration management
   - Health monitoring

2. **Agent operations** → `interactiveAgentsMenu()`
   - Deploy/manage agents
   - View agent status
   - Agent lifecycle controls

3. **Neural mesh controls** → `interactiveMeshMenu()`
   - Mesh topology configuration
   - Node connectivity
   - Mesh health diagnostics

4. **Swarm intelligence** → `interactiveSwarmMenu()`
   - PSO, ACO, flocking algorithms
   - Swarm coordination
   - Optimization objectives

5. **Hive-mind orchestration** → `interactiveHiveMindMenu()`
   - Multi-swarm coordination
   - Tree-of-Thought workflows
   - Backlog management

6. **Consensus management** → `interactiveConsensusMenu()`
   - Proposals and voting
   - Consensus algorithms (Raft, Byzantine, PoW, PoS)
   - Decision audit trails

7. **Task & router workflows** → `interactiveTasksMenu()`
   - Task submission
   - Routing policies
   - Workflow orchestration

#### Utilities
8. **Telemetry snapshot** → Quick system metrics display
9. **Run CLI command** → `interactiveCommandRunner()`
   - Embedded CLI for ad-hoc commands
   - Full access to all CLI capabilities
   - No need to exit interactive mode

#### Lifecycle Controls
10. **Exit (keep system running)** → Maintains orchestrator for background operations
11. **Exit & shutdown system** → Graceful cleanup and termination

### 3. System Persistence

The enhanced interactive mode leverages the `CliSession` singleton to maintain system state:

- **Single Orchestrator Instance**: One `CodexSynapticSystem` per CLI process
- **Shared Across Commands**: All submenu operations use the same system instance
- **Resource Efficiency**: No redundant initialization overhead
- **Background Compatibility**: System can continue running after exiting interactive mode

### 4. Improved User Experience

#### Comprehensive Help System
The `renderInteractiveHints()` function now provides detailed guidance:
- Submenu navigation instructions
- Embedded CLI runner usage
- Dashboard interpretation
- Exit behavior explanation
- System persistence model

#### Visual Enhancements
- Color-coded output using Chalk
- Emoji icons for better visual navigation
- Structured menu hierarchies
- Clear status indicators

#### Reduced Console Noise
- Log level automatically set to WARN during interactive sessions
- Previous log level restored on exit
- Clean, focused user interface

## Technical Architecture

### Key Functions

```typescript
// Enhanced interactive command (src/cli/index.ts:3457)
program
  .command('interactive')
  .alias('i')
  .description('Start interactive mode')
  .action(handleCommand('interactive', async () => {
    // Suppress verbose logs during interactive session
    const previousConsoleLevel = rootLogger.getConsoleLevel();
    rootLogger.setConsoleLevel(LogLevel.WARN);
    
    try {
      await useSystem('interactive', async (system) => {
        // Display welcome message and dashboard
        console.log(chalk.green('🎛️  Welcome to Codex-Synaptic Interactive Mode!'));
        renderInteractiveHints();
        await renderSystemDashboard(system);
        
        // Main menu loop
        let exit = false;
        while (!exit) {
          const { action } = await inquirer.prompt([...]);
          
          // Route to appropriate submenu or utility
          switch (action) {
            case 'system': await interactiveSystemMenu(); break;
            case 'agents': await interactiveAgentsMenu(); break;
            case 'mesh': await interactiveMeshMenu(); break;
            case 'swarm': await interactiveSwarmMenu(); break;
            case 'hive': await interactiveHiveMindMenu(); break;
            case 'consensus': await interactiveConsensusMenu(); break;
            case 'tasks': await interactiveTasksMenu(); break;
            case 'telemetry': renderTelemetry(); break;
            case 'command': await interactiveCommandRunner(); break;
            case 'shutdown': 
              await session.shutdown('interactive-exit');
              exit = true;
              break;
            case 'exit':
            default:
              exit = true;
              break;
          }
        }
      });
    } finally {
      rootLogger.setConsoleLevel(previousConsoleLevel);
    }
  }));
```

### Helper Functions

#### `renderInteractiveHints()` (line 340)
Enhanced to provide comprehensive guidance:
- Submenu descriptions
- CLI runner capabilities
- Dashboard interpretation
- Lifecycle management explanation

#### `ensureInteractiveSystem()` (line 348)
Ensures system persistence across interactive sessions:
- Lazy initialization via `CliSession`
- Reuses existing system instance if available
- Prevents redundant bootstrap overhead

#### `dispatchCliCommand()` (line 431)
Powers the embedded CLI runner:
- Parses ad-hoc CLI text input
- Tokenizes with quote support (`tokenizeCliArgs()`)
- Routes to appropriate Commander.js commands
- Prevents recursive interactive mode calls

#### `renderSystemDashboard()` (line 453)
Displays comprehensive system status:
- Readiness indicator
- Uptime counter
- Agent registry summary
- Mesh topology metrics
- Swarm coordination state
- Consensus mechanism status

### Submenu Handlers (Already Implemented)

All submenu handlers were already present in the codebase and have been integrated into the enhanced main menu:

- `interactiveSystemMenu()` (line 471)
- `interactiveAgentsMenu()` (line 535)
- `interactiveMeshMenu()` (line 643)
- `interactiveSwarmMenu()` (line 701)
- `interactiveHiveMindMenu()` (line 752)
- `interactiveConsensusMenu()` (line 881)
- `interactiveTasksMenu()` (line 983)
- `interactiveCommandRunner()` (line 1050)

## Usage Examples

### Basic Interactive Session

```bash
# Start interactive mode
codex-synaptic interactive

# Or use the alias
codex-synaptic i
```

### Dashboard-First Workflow

1. Launch interactive mode → See full system dashboard
2. Navigate to "System dashboard & controls"
3. Choose "View system information" to inspect configuration
4. Return to main menu
5. Navigate to "Agent operations"
6. Deploy specialized worker agents
7. Return to main menu
8. Use "Run CLI command" to execute ad-hoc operations
9. Choose "Exit (keep system running)" to maintain orchestrator

### Embedded CLI Runner

From the main menu:
1. Select "Run CLI command"
2. Enter any CLI command (e.g., `agent status`, `mesh info`, `task submit "analyze codebase"`)
3. Command executes using the in-process system
4. Returns to interactive menu automatically

### Lifecycle Management

**Keep System Running**:
- Choose "Exit (keep system running)"
- Orchestrator remains available for:
  - Background swarm operations
  - Consensus coordination
  - Auto-scaling activities
  - Self-healing mesh repairs

**Graceful Shutdown**:
- Choose "Exit & shutdown system"
- Triggers `session.shutdown('interactive-exit')`
- Cleans up resources
- Persists telemetry and state
- Terminates orchestrator

## Benefits

### Developer Experience
- **Single Pane**: No need for multiple terminals
- **Context Retention**: System state preserved across menu navigation
- **Ad-hoc Flexibility**: Embedded CLI runner for quick operations
- **Visual Clarity**: Dashboard provides instant system awareness

### Operational Efficiency
- **Resource Optimization**: Single orchestrator instance reduces overhead
- **Background Operations**: System can continue work after exit
- **Reduced Latency**: No cold-start initialization overhead for submenu operations
- **Consistent State**: All operations share the same system instance

### System Reliability
- **Graceful Lifecycle**: Explicit shutdown vs. exit distinction
- **Clean Logging**: Reduced console noise during interactive sessions
- **Error Isolation**: Each submenu operation uses `handleCommand()` wrapper
- **Telemetry Preservation**: Session telemetry captured on shutdown

## Migration Notes

### Breaking Changes
None - the enhanced interactive mode is backward compatible.

### Previous Behavior
The old interactive mode provided a minimal 5-choice menu without:
- Dashboard visualization
- Embedded CLI runner
- Explicit lifecycle controls
- Comprehensive help text

### Current Behavior
All previous functionality is preserved and enhanced with:
- 11-choice main menu (vs. 5)
- Dashboard on entry
- Embedded CLI runner
- Explicit "keep running" vs. "shutdown" options
- Comprehensive help and guidance

## Future Enhancements

Potential areas for further improvement:

1. **Saved Sessions**: Persist menu navigation history
2. **Keyboard Shortcuts**: Add hotkeys for frequently used operations
3. **Multi-Column Displays**: Side-by-side metrics in dashboard
4. **Real-time Updates**: Live-updating dashboard during long operations
5. **Favorite Commands**: Quick access to frequently used CLI commands
6. **Session Recording**: Replay previous interactive sessions
7. **Batch Operations**: Execute multiple commands in sequence

## Testing

### Manual Testing Checklist

- [ ] Interactive mode launches successfully
- [ ] Dashboard displays on entry
- [ ] All 7 submenus accessible and functional
- [ ] Telemetry snapshot displays correctly
- [ ] Embedded CLI runner executes commands
- [ ] "Exit (keep running)" maintains system
- [ ] "Exit & shutdown" performs cleanup
- [ ] Help text is clear and comprehensive
- [ ] Log level suppression works correctly
- [ ] System persistence across submenu navigation

### Integration Testing

```bash
# Test interactive mode with background operations
npm test -- tests/cli/interactive.test.ts

# Verify system persistence
npm test -- tests/cli/session.test.ts

# Check submenu handler integration
npm test -- tests/cli/menus.test.ts
```

## References

- Main CLI Implementation: `src/cli/index.ts`
- Session Management: `src/cli/session.ts`
- System Orchestrator: `src/core/system.ts`
- Agent System Documentation: `AGENTS.md`
- CLI Instructions: `docs/cli/instructions.md`
- Cheat Codes: `docs/codex-synaptic-cheat-codes.md`
