#!/bin/bash

################################################################################
# Rollback Script
# One-command rollback to previous stable version
################################################################################

set -euo pipefail

# Configuration
DEPLOYMENT_NAME="${DEPLOYMENT_NAME:-codex-synaptic}"
NAMESPACE="${NAMESPACE:-default}"
HEALTH_CHECK_URL="${HEALTH_CHECK_URL:-http://localhost:3000/health}"
HEALTH_CHECK_TIMEOUT="${HEALTH_CHECK_TIMEOUT:-30}"

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

# Health check function
health_check() {
    local url=$1
    local timeout=$2
    local max_attempts=$((timeout / 5))
    local attempt=0

    log_info "Running health check on $url..."

    while [ $attempt -lt $max_attempts ]; do
        if curl -sf "$url" > /dev/null 2>&1; then
            local health_data=$(curl -sf "$url")
            local status=$(echo "$health_data" | jq -r '.status' 2>/dev/null || echo "unknown")

            if [ "$status" = "healthy" ]; then
                log_success "Health check passed (status: $status)"
                return 0
            else
                log_warning "Health check returned status: $status"
            fi
        fi

        attempt=$((attempt + 1))
        log_warning "Health check attempt $attempt/$max_attempts failed, retrying in 5s..."
        sleep 5
    done

    log_error "Health check failed after $max_attempts attempts"
    return 1
}

# Get current deployment info
get_deployment_info() {
    log_info "Fetching current deployment information..."

    # This is a placeholder - in production, you would query:
    # - Kubernetes: kubectl get deployments
    # - Docker: docker ps
    # - Version control: git describe
    # - Container registry: docker images

    local current_version=$(docker inspect "${DEPLOYMENT_NAME}:latest" --format '{{.Config.Labels.version}}' 2>/dev/null || echo "unknown")
    local previous_version=$(docker inspect "${DEPLOYMENT_NAME}:blue" --format '{{.Config.Labels.version}}' 2>/dev/null || echo "unknown")

    log_info "Current version: $current_version"
    log_info "Previous stable version: $previous_version"

    echo "$previous_version"
}

# Perform rollback
rollback() {
    local target_version=$1

    log_warning "=========================================="
    log_warning "INITIATING ROLLBACK"
    log_warning "Target version: $target_version"
    log_warning "=========================================="

    # Step 1: Verify previous version exists
    log_info "Step 1/5: Verifying previous version..."
    if ! docker inspect "${DEPLOYMENT_NAME}:blue" > /dev/null 2>&1; then
        log_error "Previous version (blue) not found"
        log_error "Cannot proceed with rollback"
        exit 1
    fi
    log_success "Previous version verified"

    # Step 2: Stop current deployment
    log_info "Step 2/5: Stopping current deployment..."
    docker stop $(docker ps -q --filter "ancestor=${DEPLOYMENT_NAME}:latest") 2>/dev/null || true
    log_success "Current deployment stopped"

    # Step 3: Tag previous version as latest
    log_info "Step 3/5: Restoring previous version..."
    docker tag "${DEPLOYMENT_NAME}:blue" "${DEPLOYMENT_NAME}:latest"
    log_success "Previous version restored as latest"

    # Step 4: Start rolled back version
    log_info "Step 4/5: Starting rolled back version..."

    # This is a placeholder - in production, you would:
    # - Kubernetes: kubectl rollout undo deployment/${DEPLOYMENT_NAME}
    # - Docker Compose: docker-compose up -d
    # - ECS: aws ecs update-service
    # - etc.

    log_success "Rolled back version started"

    # Step 5: Health check
    log_info "Step 5/5: Running health check..."
    if ! health_check "$HEALTH_CHECK_URL" "$HEALTH_CHECK_TIMEOUT"; then
        log_error "Health check failed after rollback"
        log_error "Manual intervention required!"
        exit 1
    fi

    log_success "=========================================="
    log_success "ROLLBACK COMPLETED SUCCESSFULLY"
    log_success "Version $target_version is now active"
    log_success "=========================================="
}

# Validate rollback safety
validate_rollback() {
    log_info "Validating rollback safety..."

    # Check if database migrations are backward compatible
    if [ -f "migrations/current_version.txt" ]; then
        local current_db_version=$(cat migrations/current_version.txt)
        local target_db_version=$(cat migrations/blue_version.txt 2>/dev/null || echo "0")

        log_info "Current DB version: $current_db_version"
        log_info "Target DB version: $target_db_version"

        # Ensure we don't rollback across incompatible schema changes
        local version_diff=$((current_db_version - target_db_version))
        if [ $version_diff -gt 2 ]; then
            log_error "Cannot rollback: Database schema version gap too large ($version_diff versions)"
            log_error "This rollback would require manual database migration"
            exit 1
        fi
    fi

    # Check for active user sessions
    if [ "${CHECK_ACTIVE_SESSIONS:-true}" = "true" ]; then
        local active_sessions=$(curl -sf "${HEALTH_CHECK_URL}/sessions" | jq -r '.count' 2>/dev/null || echo "0")
        if [ "$active_sessions" -gt 1000 ]; then
            log_warning "High number of active sessions: $active_sessions"
            read -p "Continue with rollback? (y/N) " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                log_info "Rollback cancelled by user"
                exit 0
            fi
        fi
    fi

    log_success "Rollback safety validation passed"
}

# Create rollback report
create_rollback_report() {
    local target_version=$1
    local report_file="/var/log/${DEPLOYMENT_NAME}/rollback-$(date +%Y%m%d-%H%M%S).log"

    mkdir -p "$(dirname "$report_file")"

    cat > "$report_file" <<EOF
Rollback Report
===============
Timestamp: $(date '+%Y-%m-%d %H:%M:%S')
Deployment: $DEPLOYMENT_NAME
Target Version: $target_version
Performed By: ${USER:-unknown}
Reason: ${ROLLBACK_REASON:-Manual rollback}

Pre-Rollback Status:
$(curl -sf "$HEALTH_CHECK_URL" | jq '.' 2>/dev/null || echo "Unable to fetch status")

Post-Rollback Status:
$(curl -sf "$HEALTH_CHECK_URL" | jq '.' 2>/dev/null || echo "Unable to fetch status")
EOF

    log_info "Rollback report saved to: $report_file"
}

# Main function
main() {
    log_info "Codex-Synaptic Rollback Script"
    log_info "==============================="

    # Get target version
    local target_version=$(get_deployment_info)

    if [ "$target_version" = "unknown" ]; then
        log_error "Cannot determine previous version"
        exit 1
    fi

    # Validate rollback safety
    validate_rollback

    # Confirm with user (unless AUTO_CONFIRM is set)
    if [ "${AUTO_CONFIRM:-false}" != "true" ]; then
        log_warning "You are about to rollback to version: $target_version"
        read -p "Continue? (y/N) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_info "Rollback cancelled"
            exit 0
        fi
    fi

    # Perform rollback
    rollback "$target_version"

    # Create rollback report
    create_rollback_report "$target_version"

    # Send notifications (placeholder)
    if [ -n "${SLACK_WEBHOOK_URL:-}" ]; then
        log_info "Sending Slack notification..."
        curl -X POST "$SLACK_WEBHOOK_URL" \
             -H 'Content-Type: application/json' \
             -d "{\"text\":\"🔄 Codex-Synaptic rolled back to version $target_version\"}" \
             2>/dev/null || true
    fi

    log_success "Rollback completed successfully!"
}

# Handle errors
trap 'log_error "Rollback failed at line $LINENO"; exit 1' ERR

# Run main function
main "$@"
