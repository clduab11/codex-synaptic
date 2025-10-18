import { join } from 'path';
import { writeFileSync } from 'fs';
import { CodexSynapticSystem } from '../dist/core/system.js';
import { AgentType } from '../dist/core/types.js';
import { buildVectorRecordFromText } from '../dist/vector/vector-client.js';

const logEntries = [];

const now = () => new Date().toISOString();

const record = (step, status, detail) => {
  const entry = { step, status, detail, timestamp: now() };
  logEntries.push(entry);
  const payload = detail ? ` ${JSON.stringify(detail)}` : '';
  console.log(`[${status.toUpperCase()}] ${step}${payload}`);
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const shortToken = (token) => {
  if (!token || token.length <= 12) {
    return token;
  }
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
};

const ensureTenant = async (tenantManager, descriptor, logKey) => {
  const existing = descriptor.id ? await tenantManager.getTenant(descriptor.id) : null;
  if (existing) {
    record(logKey, 'ok', { ...existing, reused: true });
    return existing;
  }
  const created = await tenantManager.createTenant(descriptor);
  record(logKey, 'ok', created);
  return created;
};

async function main() {
  const startedAt = now();
  process.env.CODEX_ADMIN_PASSWORD = process.env.CODEX_ADMIN_PASSWORD ?? 'adminpass';
  process.env.CODEX_TENANCY_ENABLED = '1';

  const system = new CodexSynapticSystem();

  try {
    record('system.initialize.start', 'ok');
    await system.initialize();
    record('system.initialize.complete', 'ok');

    const authManager = system.getAuthenticationManager();
    const { token } = await authManager.authenticate('admin', process.env.CODEX_ADMIN_PASSWORD);
    record('auth.token.minted', 'ok', { tokenPreview: shortToken(token) });

  const tenantManager = system.getTenantManager();
  const tenantAlpha = await ensureTenant(tenantManager, { name: 'Tenant Alpha', id: 'tenant-alpha' }, 'tenant.create.alpha');
  const tenantBravo = await ensureTenant(tenantManager, { name: 'Tenant Bravo', id: 'tenant-bravo' }, 'tenant.create.bravo');
    await tenantManager.upsertPolicy({
      tenantId: 'tenant-bravo',
      quota: { maxConcurrentTasks: 0, cpuLimitPercent: 50, memoryLimitMb: 256 }
    });
    record('tenant.quota.bravo', 'ok', await tenantManager.getQuota('tenant-bravo'));

    const meshStatus = await system.createNeuralMesh('ring', 6).then(() => system.getNeuralMesh().getStatus());
    record('mesh.configure.ring', 'ok', meshStatus);

    const outcomeAlpha = await system.executeTask(
      'Draft a readiness brief for the multi-tenant Codex-Synaptic rollout, highlight quota defaults and vector coverage.',
      { tenantId: 'tenant-alpha' }
    );
    record('task.execute.alpha', 'ok', { summary: outcomeAlpha?.summary ?? null });

    try {
      await system.executeTask(
        'Attempt guarded tenant workflow that should trip quota enforcement.',
        { tenantId: 'tenant-bravo' }
      );
      record('task.execute.bravo', 'error', { message: 'Quota enforcement did not trigger' });
    } catch (error) {
      record('task.execute.bravo', 'ok', { message: error?.message ?? String(error) });
    }

    await system.startSwarm('pso', ['latency', 'resilience', 'throughput']);
    await wait(2500);
    record('swarm.status.running', 'ok', system.getSwarmCoordinator().getStatus());
    system.getSwarmCoordinator().stopSwarm('manual');
    await wait(250);
    record('swarm.status.stopped', 'ok', system.getSwarmCoordinator().getStatus());

    await system.deployAgent(AgentType.CONSENSUS_COORDINATOR, 2);
    const consensusAgents = system.getAgentRegistry().getAgentsByType(AgentType.CONSENSUS_COORDINATOR);
    record('consensus.agents.ready', 'ok', { count: consensusAgents.length });

    const consensusOutcomePromise = new Promise((resolve) => {
      system.once('consensusReached', (event) => resolve(event));
    });
    const proposalId = await system.proposeConsensus('tenant_policy_change', {
      tenantId: 'tenant-alpha',
      change: 'Promote observability dashboards'
    });
    record('consensus.proposed', 'ok', { proposalId });
    for (const agent of consensusAgents.slice(0, 3)) {
      system.submitConsensusVote(proposalId, true, agent.id);
    }
    const consensusOutcome = await consensusOutcomePromise;
    record('consensus.result', 'ok', consensusOutcome);

    const memory = system.getMemorySystem();
    await memory.store('tenant_notes', 'alpha-init', { message: 'Tenant Alpha bootstrap complete' }, { tenantId: 'tenant-alpha' });
    await memory.store('tenant_notes', 'bravo-init', { message: 'Quota locked to zero for guard rails' }, { tenantId: 'tenant-bravo' });
    const memoryAlpha = await memory.list('tenant_notes', 10, { tenantId: 'tenant-alpha' });
    const memoryAll = await memory.list('tenant_notes', 10);
    record('memory.snapshot.alpha', 'ok', { count: memoryAlpha.length });
    record('memory.snapshot.all', 'ok', { count: memoryAll.length });

    const vectorClient = system.getVectorClient();
    if (vectorClient) {
      const recordId = `tenant-alpha-${Date.now()}`;
      const vectorRecord = buildVectorRecordFromText(
        recordId,
        'Codex-Synaptic tenant alpha knowledge vector covering quotas and observability.'
      );
      await vectorClient.upsert('codex-synaptic', [vectorRecord]);
      const searchResults = await vectorClient.search('codex-synaptic', vectorRecord.vector, 3);
      record('vector.search', 'ok', { count: searchResults.length, firstId: searchResults[0]?.id ?? null });
    } else {
      record('vector.search', 'error', { message: 'Vector client not initialized' });
    }
  } catch (error) {
    record('system.run.error', 'error', { message: error?.message ?? String(error) });
    throw error;
  } finally {
    await system.shutdown();
    record('system.shutdown', 'ok');
    const finishedAt = now();
    const logPath = join(process.cwd(), 'logs', `e2e-run-${Date.now()}.json`);
    writeFileSync(logPath, JSON.stringify({ startedAt, finishedAt, steps: logEntries }, null, 2), 'utf8');
    console.log(`E2E results written to ${logPath}`);
  }
}

main().catch((error) => {
  console.error('E2E runner failed:', error?.stack ?? error?.message ?? String(error));
  process.exitCode = 1;
});
