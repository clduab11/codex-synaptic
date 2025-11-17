# Production Operations Playbook

## Table of Contents

1. [Pre-Launch Checklist](#pre-launch-checklist)
2. [Deployment Procedures](#deployment-procedures)
3. [Monitoring & Observability](#monitoring--observability)
4. [Incident Response](#incident-response)
5. [Rollback Procedures](#rollback-procedures)
6. [Health Check Endpoints](#health-check-endpoints)
7. [Performance Targets](#performance-targets)
8. [Security Operations](#security-operations)
9. [On-Call Procedures](#on-call-procedures)
10. [Post-Launch Monitoring](#post-launch-monitoring)

---

## Pre-Launch Checklist

### ✅ Infrastructure

- [ ] Load balancers configured and tested
- [ ] Auto-scaling policies set (scale at 60% capacity)
- [ ] Database connection pooling optimized
- [ ] CDN configured for static assets
- [ ] Backup/DR tested (RPO: 1hr, RTO: 4hrs)
- [ ] SSL/TLS certificates valid and auto-renewal configured
- [ ] DNS records configured with appropriate TTLs

### ✅ Security

- [ ] All API keys rotated to production values
- [ ] Secrets stored in secrets manager (HashiCorp Vault/AWS Secrets Manager)
- [ ] Rate limiting enabled and configured
- [ ] CORS whitelist configured for production domains only
- [ ] Security headers (CSP, HSTS, X-Frame-Options) configured
- [ ] Zero high/critical vulnerabilities from security scans
- [ ] Audit logging enabled for all data access

### ✅ Monitoring & Observability

- [ ] OpenTelemetry/Jaeger distributed tracing configured
- [ ] Structured logging with correlation IDs enabled
- [ ] Prometheus metrics exporters configured
- [ ] Grafana/Datadog dashboards created
- [ ] Alert thresholds configured:
  - P1 alerts: <1min response time
  - P2 alerts: <15min response time
  - P3 alerts: <4hrs response time

### ✅ Performance

- [ ] Load testing completed (3x expected peak load)
- [ ] Stress testing passed
- [ ] 24hr soak test completed at 150% normal load
- [ ] Spike test validated (10x traffic burst resilience)
- [ ] Bundle size: <500KB gzipped for main bundle
- [ ] Time to Interactive: <3s on 3G networks
- [ ] Lighthouse score: >90 across all metrics

### ✅ Feature Flags

- [ ] All experimental features disabled
- [ ] Kill-switches tested and verified
- [ ] Feature flag refresh mechanism configured

---

## Deployment Procedures

### Blue-Green Deployment Strategy

Our deployment strategy uses a three-stage blue-green approach with automatic rollback:

#### Stage 1: Canary (5% traffic) - 2 hours

```bash
# Set environment variables
export VERSION="1.2.3"
export DEPLOYMENT_NAME="codex-synaptic"
export HEALTH_CHECK_URL="https://api.yourdomain.com/health"

# Run deployment script
./scripts/deploy-blue-green.sh
```

**Monitoring during canary:**

- Error rate threshold: <2x baseline
- Health checks every 30 seconds
- Automatic rollback if thresholds exceeded

#### Stage 2: Expanded Rollout (25% traffic) - 4 hours

**Validation:**

- All critical user paths tested
- Error rate <0.1% for critical paths
- Response time p95 <250ms

#### Stage 3: Full Cutover (100% traffic) - 30 min soak

**Health Check Requirements:**

- Health endpoint returning 200 OK
- All subsystems (mesh, swarm, consensus) healthy
- Memory usage <80%
- CPU usage <70%

**Post-Cutover:**

- Monitor for 30 minutes before decomissioning old version
- Keep old version (blue) available for quick rollback

### Manual Deployment Commands

```bash
# 1. Build and tag new version
docker build -t codex-synaptic:${VERSION} .
docker tag codex-synaptic:${VERSION} codex-synaptic:green

# 2. Switch traffic gradually
# (Update load balancer configuration)

# 3. Monitor health
watch -n 5 'curl -sf https://api.yourdomain.com/health | jq .'

# 4. Full cutover after validation
# (Update all traffic to green)

# 5. Tag as new blue (stable) version
docker tag codex-synaptic:green codex-synaptic:blue
```

---

## Monitoring & Observability

### Key Metrics Dashboard

**Response Time (Target: p50/p95/p99: <100ms/250ms/500ms)**

```
http_request_duration_ms_bucket
```

**Error Rate (Target: <0.1% for critical paths)**

```
rate(http_request_errors_total[5m]) / rate(http_requests_total[5m]) * 100
```

**Throughput**

```
rate(http_requests_total[1m])
```

**Resource Utilization**

- CPU: Target <70% under normal load
- Memory: Target <80% under normal load

```
system_cpu_usage_percent
system_memory_usage_bytes / system_memory_total_bytes * 100
```

### Alerting Rules

**P1 Alerts (Page immediately, <1min response)**

- Error rate >5% for 2 minutes
- All health checks failing
- CPU >95% for 5 minutes
- Memory >95% for 3 minutes
- Disk usage >90%

**P2 Alerts (Notify on-call, <15min response)**

- Error rate >1% for 10 minutes
- Response time p95 >1000ms for 5 minutes
- CPU >80% for 10 minutes
- Memory >85% for 10 minutes
- Consensus manager unhealthy

**P3 Alerts (Create ticket, <4hrs response)**

- Error rate >0.5% for 30 minutes
- Response time p95 >500ms for 15 minutes
- Agent failures >10% for 1 hour
- Swarm optimization degraded

### Distributed Tracing

Access tracing at: `https://jaeger.yourdomain.com`

**Key traces to monitor:**

- Agent task execution
- Consensus decision flow
- Swarm optimization iterations
- Neural mesh message propagation

---

## Health Check Endpoints

### Endpoints

**`GET /health`** - Detailed health check

```json
{
  "status": "healthy",
  "timestamp": "2025-01-17T12:00:00Z",
  "uptime": 3600,
  "version": "1.2.3",
  "components": {
    "system": {
      "status": "healthy",
      "latency": 2.5,
      "metadata": { "heapUsedPercent": "45.23" }
    },
    "agent_registry": {
      "status": "healthy",
      "latency": 5.1,
      "metadata": { "totalAgents": 12, "activeAgents": 10 }
    },
    "neural_mesh": {
      "status": "healthy",
      "latency": 3.2,
      "metadata": { "nodeCount": 15, "connectionCount": 42 }
    }
  }
}
```

**`GET /health/live`** - Liveness probe (K8s)

```json
{ "alive": true }
```

**`GET /health/ready`** - Readiness probe (K8s)

```json
{ "ready": true }
```

**`GET /metrics`** - Prometheus metrics

```
# HELP http_requests_total Total HTTP requests
# TYPE http_requests_total counter
http_requests_total 1234

# HELP http_request_duration_ms HTTP request duration in milliseconds
# TYPE http_request_duration_ms histogram
http_request_duration_ms_bucket{le="10"} 100
...
```

---

## Incident Response

### Severity Levels

**P1 - Critical**

- Service completely down
- Data loss or corruption
- Security breach
- Response: Page immediately, all hands on deck

**P2 - High**

- Partial service degradation
- Elevated error rates
- Performance severely degraded
- Response: Notify on-call team within 15 minutes

**P3 - Medium**

- Minor service degradation
- Non-critical features affected
- Response: Create ticket, address within 4 hours

**P4 - Low**

- Cosmetic issues
- Non-urgent improvements
- Response: Create ticket, address in next sprint

### Incident Response Steps

1. **Acknowledge**
   - Confirm incident in monitoring system
   - Update status page
   - Notify stakeholders

2. **Assess**
   - Check health dashboard
   - Review recent deployments
   - Check error logs and traces

3. **Mitigate**
   - If recent deployment: Execute rollback
   - If resource exhaustion: Scale up
   - If dependency failure: Enable circuit breaker

4. **Resolve**
   - Fix root cause
   - Deploy fix through normal process
   - Verify resolution

5. **Document**
   - Write postmortem
   - Update runbooks
   - Create action items

### Common Issues & Solutions

#### High Error Rate

```bash
# 1. Check recent deployments
git log -10 --oneline

# 2. Check error logs
kubectl logs -f deployment/codex-synaptic --tail=100 | grep ERROR

# 3. If after recent deployment, rollback
./scripts/rollback.sh

# 4. If not deployment-related, scale up
kubectl scale deployment/codex-synaptic --replicas=10
```

#### Memory Leak

```bash
# 1. Identify leaking process
kubectl top pods

# 2. Restart affected pods
kubectl rollout restart deployment/codex-synaptic

# 3. Monitor memory usage
watch -n 5 'kubectl top pods | grep codex'

# 4. If leak persists, enable heap profiling
export ENABLE_HEAP_PROFILING=true
```

#### Database Connection Issues

```bash
# 1. Check connection pool stats
curl -sf https://api.yourdomain.com/health | jq '.components.database'

# 2. Increase pool size
export DB_POOL_SIZE=20

# 3. Restart service
kubectl rollout restart deployment/codex-synaptic

# 4. If database is overwhelmed
# Scale read replicas or enable connection proxy
```

---

## Rollback Procedures

### Automatic Rollback

Automatic rollback is triggered when:

- Error rate exceeds 2x baseline during deployment
- Health checks fail during any deployment stage

### Manual Rollback

```bash
# Quick one-command rollback
./scripts/rollback.sh

# With confirmation prompt disabled (emergency)
export AUTO_CONFIRM=true
export ROLLBACK_REASON="Production incident #1234"
./scripts/rollback.sh

# Verify rollback success
curl -sf https://api.yourdomain.com/health | jq '.version'
```

### Database Migration Rollback

Database migrations are backward-compatible for 2 releases:

```bash
# Rollback database migration
npm run db:migrate:undo

# Verify database version
npm run db:version
```

**Important:** Never rollback across >2 migration versions without manual intervention.

---

## Performance Targets

### Response Time

| Percentile | Target | Alert Threshold |
| ---------- | ------ | --------------- |
| p50        | <100ms | >250ms          |
| p90        | <200ms | >500ms          |
| p95        | <250ms | >750ms          |
| p99        | <500ms | >1000ms         |

### Error Rate

| Path Type     | Target | Alert Threshold |
| ------------- | ------ | --------------- |
| Critical      | <0.1%  | >0.5%           |
| Standard      | <0.5%  | >2%             |
| Non-essential | <1%    | >5%             |

### Throughput

| Load Level | Target RPS | Notes                   |
| ---------- | ---------- | ----------------------- |
| Normal     | 1,000      | Baseline steady state   |
| Peak       | 3,000      | Daily peak hours        |
| Burst      | 10,000     | Should handle for 5 min |

---

## Security Operations

### API Key Rotation

```bash
# 1. Generate new keys in secrets manager
aws secretsmanager create-secret --name openai-api-key-v2

# 2. Update feature flag to use new key
# (No deployment needed - uses runtime config)

# 3. Monitor error rate for 24 hours

# 4. Deprecate old key
aws secretsmanager delete-secret --secret-id openai-api-key-v1
```

### Security Incident Response

1. **Suspected breach:**
   - Rotate all credentials immediately
   - Enable additional logging
   - Notify security team

2. **DDoS attack:**
   - Enable rate limiting (feature flag)
   - Activate WAF rules
   - Scale infrastructure

3. **Vulnerability disclosure:**
   - Assess severity (CVSS score)
   - Patch within SLA:
     - Critical: 24 hours
     - High: 7 days
     - Medium: 30 days

---

## On-Call Procedures

### Week 1 Monitoring Protocol

**Daily Health Checks (9AM & 5PM):**

```bash
# Run health check script
./scripts/health-check.sh

# Review key metrics
curl -sf https://api.yourdomain.com/metrics | grep -E "(error_rate|response_time|memory_usage)"

# Check alerts
# Visit Grafana/Datadog dashboard
```

**On-Call Rotation:**

- Primary: 24/7 coverage
- Secondary: Backup escalation
- Manager: Final escalation

**Response Times:**

- P1: <1 minute
- P2: <15 minutes
- P3: <4 hours

---

## Post-Launch Monitoring

### User Feedback Loop

**Week 1:**

- Survey first 100 users
- Monitor support tickets
- Track top 3 pain points
- Iterate on highest-impact issues

### Performance Benchmarking

**Compare pre/post launch metrics:**

```bash
# Export metrics for analysis
curl -sf https://api.yourdomain.com/metrics > metrics-$(date +%Y%m%d).json

# Generate performance report
npm run performance:report
```

**Key comparisons:**

- Response time improvements
- Error rate changes
- Resource utilization efficiency
- Cost per request

### Growth Preparation

**Auto-Scaling Configuration:**

```yaml
minReplicas: 3
maxReplicas: 20
targetCPUUtilizationPercentage: 60
targetMemoryUtilizationPercentage: 70
```

**Database Scaling:**

- Read replicas: Auto-scale based on connection pool saturation
- Write capacity: Monitor for >70% utilization
- Connection pooling: max_connections = 100

**CDN Optimization:**

- Cache-Control headers set
- Edge locations configured globally
- Purge strategy defined

---

## Emergency Contacts

| Role                | Contact Method           | Response Time |
| ------------------- | ------------------------ | ------------- |
| Primary On-Call     | PagerDuty                | <1 min        |
| Engineering Manager | Phone + Slack            | <5 min        |
| Security Team       | security@yourdomain.com  | <15 min       |
| Infrastructure Team | infra@yourdomain.com     | <15 min       |
| Executive On-Call   | Phone (emergencies only) | <30 min       |

---

## Runbook Maintenance

This runbook should be reviewed and updated:

- After every major incident
- Quarterly as part of operational review
- When adding new features or infrastructure

**Last Updated:** 2025-01-17
**Version:** 1.0.0
**Owner:** SRE Team
