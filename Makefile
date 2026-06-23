# =============================================
# Chess Platform - Makefile
# =============================================
# Quick commands for development workflow
#
# Usage:
#   make dev        - Start development environment
#   make test       - Run tests
#   make build      - Build Docker image
#   make migrate    - Run database migrations
#   make seed       - Run seed data
#   make logs       - View service logs
#   make stop       - Stop all services
# =============================================

# Configuration
PROJECT_NAME := chess-platform
DOCKER_REGISTRY ?= docker.io
DOCKER_USERNAME ?= your-username
IMAGE_TAG ?= latest
GIT_SHA := $(shell git rev-parse --short HEAD 2>/dev/null || echo "latest")

# Docker Compose files
COMPOSE_DEV := docker/docker-compose.yml
COMPOSE_PROD := docker/docker-compose.prod.yml
COMPOSE_STAGING := docker/docker-compose.staging.yml

# Colors for output
BLUE := \033[36m
GREEN := \033[32m
YELLOW := \033[33m
RED := \033[31m
RESET := \033[0m

.PHONY: help dev dev-full test test-cov test-e2e build build-prod push migrate migrate-rollback seed seed-reset logs logs-prod stop stop-all clean lint format security-scan deploy-staging deploy-prod status setup

# =============================================
# Default: Show help
# =============================================
help: ## Show this help message
	@echo "$(GREEN)Chess Platform - Available Commands$(RESET)"
	@echo "========================================"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(BLUE)%-20s$(RESET) %s\n", $$1, $$2}'

# =============================================
# Development
# =============================================
dev: ## Start development environment (PostgreSQL, Redis, RabbitMQ)
	@echo "$(GREEN)Starting development environment...$(RESET)"
	docker compose -f $(COMPOSE_DEV) up -d postgres redis rabbitmq pgbouncer
	@echo "$(GREEN)Services started!$(RESET)"
	@echo "$(YELLOW)Waiting for services to be ready...$(RESET)"
	@sleep 5
	@make status

dev-full: ## Start full development environment (including app)
	@echo "$(GREEN)Starting full development environment...$(RESET)"
	docker compose -f $(COMPOSE_DEV) --profile full up -d
	@echo "$(GREEN)All services started!$(RESET)"
	@make status

dev-logs: ## View development environment logs
	docker compose -f $(COMPOSE_DEV) logs -f

setup: ## Initial project setup (install deps, start services, run migrations)
	@echo "$(GREEN)Setting up project...$(RESET)"
	npm install
	@make dev
	@echo "$(YELLOW)Waiting for database...$(RESET)"
	@sleep 5
	@make migrate
	@make seed
	@echo "$(GREEN)Setup complete!$(RESET)"

# =============================================
# Testing
# =============================================
test: ## Run unit tests
	@echo "$(GREEN)Running unit tests...$(RESET)"
	npm run test

test-cov: ## Run tests with coverage
	@echo "$(GREEN)Running tests with coverage...$(RESET)"
	npm run test:cov

test-e2e: ## Run end-to-end tests
	@echo "$(GREEN)Running e2e tests...$(RESET)"
	npm run test:e2e

test-watch: ## Run tests in watch mode
	@echo "$(GREEN)Running tests in watch mode...$(RESET)"
	npm run test:watch

# =============================================
# Build
# =============================================
build: ## Build TypeScript application
	@echo "$(GREEN)Building application...$(RESET)"
	npm run build

build-docker: ## Build Docker image locally
	@echo "$(GREEN)Building Docker image...$(RESET)"
	docker build -f docker/Dockerfile -t $(DOCKER_USERNAME)/$(PROJECT_NAME):$(GIT_SHA) -t $(DOCKER_USERNAME)/$(PROJECT_NAME):$(IMAGE_TAG) .
	@echo "$(GREEN)Docker image built: $(DOCKER_USERNAME)/$(PROJECT_NAME):$(GIT_SHA)$(RESET)"

build-docker-no-cache: ## Build Docker image without cache
	@echo "$(GREEN)Building Docker image (no cache)...$(RESET)"
	docker build --no-cache -f docker/Dockerfile -t $(DOCKER_USERNAME)/$(PROJECT_NAME):$(GIT_SHA) .

push: build-docker ## Build and push Docker image to registry
	@echo "$(GREEN)Pushing Docker image to registry...$(RESET)"
	docker push $(DOCKER_USERNAME)/$(PROJECT_NAME):$(GIT_SHA)
	docker push $(DOCKER_USERNAME)/$(PROJECT_NAME):$(IMAGE_TAG)

# =============================================
# Database
# =============================================
migrate: ## Run database migrations
	@echo "$(GREEN)Running database migrations...$(RESET)"
	npx prisma migrate deploy

migrate-dev: ## Create and apply a new migration (development)
	@echo "$(GREEN)Creating new migration...$(RESET)"
	npx prisma migrate dev

migrate-rollback: ## Rollback last migration (development only)
	@echo "$(YELLOW)Rolling back last migration...$(RESET)"
	npx prisma migrate resolve --rolled-back

migrate-reset: ## Reset database (DEVELOPMENT ONLY - all data will be lost)
	@echo "$(RED)WARNING: This will reset the database and delete all data!$(RESET)"
	@read -p "Are you sure? [y/N] " confirm && [ $$confirm = y ] && npx prisma migrate reset --force || echo "Cancelled"

migrate-status: ## Check migration status
	@echo "$(GREEN)Checking migration status...$(RESET)"
	npx prisma migrate status

seed: ## Run database seed
	@echo "$(GREEN)Running database seed...$(RESET)"
	npx prisma db seed

seed-reset: ## Reset and re-seed database (DEVELOPMENT ONLY)
	@echo "$(YELLOW)Resetting and re-seeding database...$(RESET)"
	npx prisma migrate reset --force
	@make seed

db-studio: ## Open Prisma Studio
	@echo "$(GREEN)Opening Prisma Studio...$(RESET)"
	npx prisma studio

db-generate: ## Generate Prisma client
	@echo "$(GREEN)Generating Prisma client...$(RESET)"
	npx prisma generate

# =============================================
# Lint & Format
# =============================================
lint: ## Run ESLint
	@echo "$(GREEN)Running ESLint...$(RESET)"
	npm run lint

lint-fix: ## Run ESLint and fix issues
	@echo "$(GREEN)Running ESLint with auto-fix...$(RESET)"
	npm run lint -- --fix

format: ## Format code with Prettier
	@echo "$(GREEN)Formatting code...$(RESET)"
	npx prettier --write "src/**/*.ts"

format-check: ## Check code formatting
	@echo "$(GREEN)Checking code formatting...$(RESET)"
	npx prettier --check "src/**/*.ts"

# =============================================
# Logs
# =============================================
logs: ## View development service logs
	docker compose -f $(COMPOSE_DEV) logs -f

logs-app: ## View app logs (dev)
	docker compose -f $(COMPOSE_DEV) logs -f app

logs-db: ## View database logs
	docker compose -f $(COMPOSE_DEV) logs -f postgres

logs-redis: ## View Redis logs
	docker compose -f $(COMPOSE_DEV) logs -f redis

logs-rabbitmq: ## View RabbitMQ logs
	docker compose -f $(COMPOSE_DEV) logs -f rabbitmq

logs-prod: ## View production logs
	docker compose -f $(COMPOSE_PROD) logs -f

logs-nginx: ## View nginx logs
	docker compose -f $(COMPOSE_PROD) logs -f nginx

# =============================================
# Stop & Clean
# =============================================
stop: ## Stop development environment
	@echo "$(YELLOW)Stopping development environment...$(RESET)"
	docker compose -f $(COMPOSE_DEV) down

stop-prod: ## Stop production environment
	@echo "$(YELLOW)Stopping production environment...$(RESET)"
	docker compose -f $(COMPOSE_PROD) down

stop-all: ## Stop all environments and remove volumes
	@echo "$(RED)Stopping all environments...$(RESET)"
	docker compose -f $(COMPOSE_DEV) down -v
	docker compose -f $(COMPOSE_PROD) down -v

clean: stop-all ## Remove all containers, volumes, and images
	@echo "$(RED)Cleaning up Docker resources...$(RESET)"
	docker system prune -f
	docker volume prune -f

# =============================================
# Security
# =============================================
security-scan: ## Scan Docker image for vulnerabilities with Trivy
	@echo "$(GREEN)Scanning Docker image for vulnerabilities...$(RESET)"
	@docker images $(DOCKER_USERNAME)/$(PROJECT_NAME):latest --format "{{.Repository}}:{{.Tag}}" | grep -q . || (echo "$(RED)Image not found. Run 'make build-docker' first.$(RESET)" && exit 1)
	docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
		aquasec/trivy:latest image --exit-code 0 --severity HIGH,CRITICAL \
		$(DOCKER_USERNAME)/$(PROJECT_NAME):latest

dependency-check: ## Check for outdated dependencies
	@echo "$(GREEN)Checking for outdated dependencies...$(RESET)"
	npm outdated

audit: ## Run npm audit
	@echo "$(GREEN)Running npm audit...$(RESET)"
	npm audit

audit-fix: ## Fix security vulnerabilities
	@echo "$(GREEN)Fixing security vulnerabilities...$(RESET)"
	npm audit fix

# =============================================
# Deployment
# =============================================
deploy-staging: ## Deploy to staging environment
	@echo "$(GREEN)Deploying to staging...$(RESET)"
	docker compose -f $(COMPOSE_STAGING) pull app
	docker compose -f $(COMPOSE_STAGING) up -d
	@echo "$(GREEN)Staging deployment complete!$(RESET)"

deploy-prod: ## Deploy to production environment
	@echo "$(GREEN)Deploying to production...$(RESET)"
	docker compose -f $(COMPOSE_PROD) pull app
	docker compose -f $(COMPOSE_PROD) up -d
	@echo "$(GREEN)Production deployment complete!$(RESET)"

deploy-prod-rolling: ## Rolling deployment to production (zero-downtime)
	@echo "$(GREEN)Starting rolling deployment...$(RESET)"
	@# Update one instance at a time
	@for instance in app1 app2 app3; do \
		echo "$(YELLOW)Updating $$instance...$(RESET)"; \
		docker compose -f $(COMPOSE_PROD) stop $$instance; \
		docker compose -f $(COMPOSE_PROD) rm -f $$instance; \
		docker compose -f $(COMPOSE_PROD) pull $$instance; \
		docker compose -f $(COMPOSE_PROD) up -d $$instance; \
		echo "$(GREEN)Waiting for $$instance to be healthy...$(RESET)"; \
		sleep 10; \
	done
	@echo "$(GREEN)Rolling deployment complete!$(RESET)"

# =============================================
# Status & Info
# =============================================
status: ## Show status of all services
	@echo "$(GREEN)=== Service Status ===$(RESET)"
	@docker compose -f $(COMPOSE_DEV) ps 2>/dev/null || echo "$(YELLOW)Development services not running$(RESET)"

ps: status ## Alias for status

images: ## List project Docker images
	@echo "$(GREEN)=== Project Images ===$(RESET)"
	docker images | grep $(PROJECT_NAME) || echo "$(YELLOW)No project images found$(RESET)"

stats: ## Show container resource usage
	@echo "$(GREEN)=== Container Stats ===$(RESET)"
	docker stats --no-stream $(shell docker compose -f $(COMPOSE_DEV) ps -q 2>/dev/null) $(shell docker compose -f $(COMPOSE_PROD) ps -q 2>/dev/null) 2>/dev/null || echo "$(YELLOW)No running containers$(RESET)"

# =============================================
# Utilities
# =============================================
shell-db: ## Open PostgreSQL shell
	@echo "$(GREEN)Opening PostgreSQL shell...$(RESET)"
	docker compose -f $(COMPOSE_DEV) exec postgres psql -U chess -d chess_platform

shell-redis: ## Open Redis CLI
	@echo "$(GREEN)Opening Redis CLI...$(RESET)"
	docker compose -f $(COMPOSE_DEV) exec redis redis-cli

backup: ## Create database backup
	@echo "$(GREEN)Creating database backup...$(RESET)"
	@mkdir -p backups
	@TIMESTAMP=$$(date +%Y%m%d_%H%M%S); \
	docker compose -f $(COMPOSE_DEV) exec -T postgres pg_dump -U chess -d chess_platform | gzip > backups/chess_platform_$${TIMESTAMP}.sql.gz; \
	echo "$(GREEN)Backup saved to: backups/chess_platform_$${TIMESTAMP}.sql.gz$(RESET)"

restore: ## Restore database from backup (provide BACKUP_FILE=path)
	@echo "$(GREEN)Restoring database from backup...$(RESET)"
	@if [ -z "$(BACKUP_FILE)" ]; then \
		echo "$(RED)Please provide BACKUP_FILE=path/to/backup.sql.gz$(RESET)"; \
		exit 1; \
	fi
	gunzip < $(BACKUP_FILE) | docker compose -f $(COMPOSE_DEV) exec -T postgres psql -U chess -d chess_platform
	@echo "$(GREEN)Restore complete!$(RESET)"

version: ## Show version info
	@echo "$(GREEN)=== Chess Platform Version ===$(RESET)"
	@echo "Git SHA:      $(GIT_SHA)"
	@echo "Image Tag:    $(IMAGE_TAG)"
	@echo "Registry:     $(DOCKER_REGISTRY)"
	@echo "Image:        $(DOCKER_USERNAME)/$(PROJECT_NAME):$(GIT_SHA)"
