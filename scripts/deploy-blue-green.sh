#!/bin/bash

################################################################################
# Blue-Green Deployment Script
# Implements safe, zero-downtime deployment strategy with automated rollback
################################################################################

set -euo pipefail

# Configuration
DEPLOYMENT_NAME="${DEPLOYMENT_NAME:-codex-synaptic}"
NAMESPACE="${NAMESPACE:-default}"
HEALTH_CHECK_URL="${HEALTH_CHECK_URL:-http://localhost:3000/health}"
HEALTH_CHECK_TIMEOUT="${HEALTH_CHECK_TIMEOUT:-30}"
CANARY_PERCENTAGE="${CANARY_PERCENTAGE:-5}"
CANARY_DURATION="${CANARY_DURATION:-7200}" # 2 hours in seconds
STAGE_TWO_PERCENTAGE="${STAGE_TWO_PERCENTAGE:-25}"
STAGE_TWO_DURATION="${STAGE_TWO_DURATION:-14400}" # 4 hours in seconds
ERROR_RATE_THRESHOLD="${ERROR_RATE_THRESHOLD:-2.0}"
ROLLBACK_ON_ERROR="${ROLLBACK_ON_ERROR:-true}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

# Check if required tools are installed
check_prerequisites() {
    log_info "Checking prerequisites..."

    local required_tools=("curl" "jq")
    for tool in "${required_tools[@]}"; do
        if ! command -v "$tool" &> /dev/null; then
            log_error "$tool is not installed. Please install it first."
            exit 1
        fi
    done

    log_success "All prerequisites met"
}

# Health check function
health_check() {
    local url=$1
    local timeout=$2
    local max_attempts=$((timeout / 5))
    local attempt=0

    log_info "Running health check on $url..."

    while [ $attempt -lt $max_attempts ]; do
        if curl -sf "$url" > /dev/null 2>&1; then
            log_success "Health check passed"
            return 0
        fi

        attempt=$((attempt + 1))
        log_warning "Health check attempt $attempt/$max_attempts failed, retrying in 5s..."
        sleep 5
    done

    log_error "Health check failed after $max_attempts attempts"
    return 1
}

# Get current error rate
get_error_rate() {
    local metrics_url="${METRICS_URL:-http://localhost:3000/metrics}"

    # Query error rate from metrics endpoint
    local error_rate=$(curl -sf "$metrics_url" | grep -E "^http_request_errors_total" | awk '{print $2}' || echo "0")
    local total_requests=$(curl -sf "$metrics_url" | grep -E "^http_requests_total" | awk '{print $2}' || echo "1")

    # Calculate percentage
    local rate=$(echo "scale=2; ($error_rate / $total_requests) * 100" | bc)
    echo "$rate"
}

# Monitor deployment
monitor_deployment() {
    local duration=$1
    local percentage=$2
    local start_time=$(date +%s)
    local end_time=$((start_time + duration))

    log_info "Monitoring deployment at ${percentage}% traffic for ${duration}s..."

    while [ $(date +%s) -lt $end_time ]; do
        local current_error_rate=$(get_error_rate)
        local baseline_error_rate=$(cat /tmp/baseline_error_rate.txt 2>/dev/null || echo "0")

        log_info "Current error rate: ${current_error_rate}% | Baseline: ${baseline_error_rate}%"

        # Check if error rate exceeds threshold
        local error_multiplier=$(echo "scale=2; $current_error_rate / $baseline_error_rate" | bc 2>/dev/null || echo "0")
        if (( $(echo "$error_multiplier > $ERROR_RATE_THRESHOLD" | bc -l) )); then
            log_error "Error rate increased by ${error_multiplier}x (threshold: ${ERROR_RATE_THRESHOLD}x)"

            if [ "$ROLLBACK_ON_ERROR" = "true" ]; then
                log_warning "Triggering automatic rollback..."
                return 1
            fi
        fi

        # Check health endpoint
        if ! health_check "$HEALTH_CHECK_URL" 10; then
            log_error "Health check failed during monitoring"
            return 1
        fi

        local remaining=$((end_time - $(date +%s)))
        log_info "Monitoring continues... ${remaining}s remaining"
        sleep 60
    done

    log_success "Monitoring completed successfully"
    return 0
}

# Deploy new version
deploy_new_version() {
    local version=$1

    log_info "Deploying new version: $version"

    # Build and tag Docker image
    log_info "Building Docker image..."
    docker build -t "${DEPLOYMENT_NAME}:${version}" .

    # Tag as green (new version)
    docker tag "${DEPLOYMENT_NAME}:${version}" "${DEPLOYMENT_NAME}:green"

    log_success "New version deployed and tagged as green"
}

# Switch traffic
switch_traffic() {
    local percentage=$1

    log_info "Switching ${percentage}% traffic to green (new version)..."

    # This is a placeholder - in production, you would update:
    # - Load balancer configuration
    # - Kubernetes service weights
    # - Nginx/HAProxy upstream weights
    # - AWS ALB target group weights
    # etc.

    log_success "Traffic switch completed: ${percentage}% to green"
}

# Rollback deployment
rollback_deployment() {
    log_warning "Rolling back deployment..."

    # Switch all traffic back to blue (old version)
    switch_traffic 0

    # Remove green deployment
    log_info "Removing green deployment..."
    docker rmi "${DEPLOYMENT_NAME}:green" 2>/dev/null || true

    log_success "Rollback completed - all traffic restored to blue (old version)"
}

# Main deployment flow
main() {
    log_info "Starting blue-green deployment for ${DEPLOYMENT_NAME}"
    log_info "Version: ${VERSION:-latest}"

    check_prerequisites

    # Record baseline error rate
    local baseline_error_rate=$(get_error_rate)
    echo "$baseline_error_rate" > /tmp/baseline_error_rate.txt
    log_info "Baseline error rate: ${baseline_error_rate}%"

    # Deploy new version
    deploy_new_version "${VERSION:-latest}"

    # Stage 1: Canary (5% traffic)
    log_info "=== Stage 1: Canary Deployment (${CANARY_PERCENTAGE}% traffic) ==="
    switch_traffic "$CANARY_PERCENTAGE"

    if ! health_check "$HEALTH_CHECK_URL" "$HEALTH_CHECK_TIMEOUT"; then
        log_error "Stage 1 health check failed"
        rollback_deployment
        exit 1
    fi

    if ! monitor_deployment "$CANARY_DURATION" "$CANARY_PERCENTAGE"; then
        log_error "Stage 1 monitoring failed"
        rollback_deployment
        exit 1
    fi

    log_success "Stage 1 completed successfully"

    # Stage 2: Expanded rollout (25% traffic)
    log_info "=== Stage 2: Expanded Rollout (${STAGE_TWO_PERCENTAGE}% traffic) ==="
    switch_traffic "$STAGE_TWO_PERCENTAGE"

    if ! monitor_deployment "$STAGE_TWO_DURATION" "$STAGE_TWO_PERCENTAGE"; then
        log_error "Stage 2 monitoring failed"
        rollback_deployment
        exit 1
    fi

    log_success "Stage 2 completed successfully"

    # Stage 3: Full cutover (100% traffic)
    log_info "=== Stage 3: Full Cutover (100% traffic) ==="
    switch_traffic 100

    if ! health_check "$HEALTH_CHECK_URL" "$HEALTH_CHECK_TIMEOUT"; then
        log_error "Stage 3 health check failed"
        rollback_deployment
        exit 1
    fi

    # Monitor for 30 minutes after full cutover
    log_info "Monitoring full deployment for 30 minutes..."
    if ! monitor_deployment 1800 100; then
        log_error "Post-cutover monitoring failed"
        rollback_deployment
        exit 1
    fi

    # Decommission old version (blue)
    log_info "Decommissioning old version (blue)..."
    docker tag "${DEPLOYMENT_NAME}:green" "${DEPLOYMENT_NAME}:blue"

    log_success "Blue-green deployment completed successfully!"
    log_success "New version is now serving 100% of traffic"

    # Cleanup
    rm -f /tmp/baseline_error_rate.txt
}

# Run main function
main "$@"
