# 通用棋牌游戏框架 - Phase 1 技术规格

## 技术栈
- **后端框架**: NestJS 10 + TypeScript 5
- **数据库**: PostgreSQL 15（主库）+ Redis 7（缓存/会话/排行榜）
- **ORM**: TypeORM 0.3
- **消息队列**: RabbitMQ 3.12
- **WebSocket**: Socket.IO 4
- **AI引擎**: 可插拔进程池（支持Minimax/MCTS/NN）
- **容器化**: Docker + Docker Compose
- **CI/CD**: GitHub Actions
- **测试**: Jest + Supertest

## Phase 1 交付物

### 1. 数据库设计
- 8张核心表：users, rooms, game_records, leaderboard_entries, achievements, user_achievements, transactions, plugins
- 数据库迁移脚本（TypeORM Migration）
- 种子数据脚本

### 2. 项目基础架构
- NestJS项目骨架（模块化结构）
- 配置文件（环境变量管理）
- Docker Compose（PostgreSQL + Redis + RabbitMQ + App）
- 健康检查端点

### 3. CI/CD流水线
- GitHub Actions: lint → test → build → docker push
- 多环境配置（dev/staging/prod）
- 自动化测试报告
