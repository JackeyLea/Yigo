import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

/**
 * 可清理对象接口
 * 实现此接口的对象可以被 CleanupRegistry 统一管理生命周期
 */
export interface Cleanupable {
  /**
   * 执行清理操作
   * 可以是同步或异步的
   */
  cleanup(): void | Promise<void>;
}

/**
 * CleanupRegistry - 统一清理注册中心
 *
 * 统一管理各模块的可清理对象，支持按 scope 分组清理。
 * 提供三种预设场景的便捷清理方法：
 * - 插件卸载时：cleanupForPlugin(pluginId)
 * - 玩家断线时：cleanupForPlayer(playerId)
 * - 房间解散时：cleanupForRoom(roomId)
 *
 * 使用方式：
 * ```typescript
 * // 注册需要清理的对象
 * cleanupRegistry.register(`plugin:${pluginId}`, someCleanupable);
 *
 * // 在模块销毁时自动清理
 * cleanupRegistry.cleanupForPlugin(pluginId);
 * ```
 */
@Injectable()
export class CleanupRegistry implements OnModuleDestroy {
  private readonly logger = new Logger(CleanupRegistry.name);
  private readonly registry = new Map<string, Set<Cleanupable>>();

  /**
   * 注册可清理对象到指定 scope
   * @param scope 清理范围标识（如 `plugin:xxx`、`player:xxx`、`room:xxx`）
   * @param cleanupable 实现了 Cleanupable 接口的对象
   */
  register(scope: string, cleanupable: Cleanupable): void {
    if (!scope || !cleanupable) {
      this.logger.warn('Cannot register empty scope or cleanupable');
      return;
    }

    if (!this.registry.has(scope)) {
      this.registry.set(scope, new Set());
    }
    this.registry.get(scope)!.add(cleanupable);

    this.logger.debug(`Registered cleanupable for scope "${scope}"`);
  }

  /**
   * 从指定 scope 取消注册可清理对象
   * @param scope 清理范围标识
   * @param cleanupable 要取消注册的对象
   */
  unregister(scope: string, cleanupable: Cleanupable): void {
    const set = this.registry.get(scope);
    if (set) {
      const deleted = set.delete(cleanupable);
      if (deleted) {
        this.logger.debug(`Unregistered cleanupable from scope "${scope}"`);
      }
      // 如果集合为空，删除该 scope
      if (set.size === 0) {
        this.registry.delete(scope);
      }
    }
  }

  /**
   * 清理指定 scope 下的所有可清理对象
   * @param scope 清理范围标识
   * @returns 清理是否成功完成
   */
  async cleanup(scope: string): Promise<void> {
    const set = this.registry.get(scope);
    if (!set || set.size === 0) {
      this.logger.debug(`No cleanupables found for scope "${scope}"`);
      return;
    }

    this.logger.log(`Cleaning up ${set.size} items for scope "${scope}"`);

    const promises: Promise<void>[] = [];
    const errors: Array<{ item: Cleanupable; error: Error }> = [];

    for (const item of set) {
      try {
        const result = item.cleanup();
        if (result instanceof Promise) {
          promises.push(
            result.catch((err) => {
              errors.push({ item, error: err });
              this.logger.error(`Async cleanup error in scope ${scope}: ${err?.message || err}`);
            }),
          );
        }
      } catch (err: any) {
        errors.push({ item, error: err });
        this.logger.error(`Cleanup error in scope ${scope}: ${err?.message || err}`);
      }
    }

    // 等待所有异步清理完成
    if (promises.length > 0) {
      await Promise.all(promises);
    }

    // 从注册表中移除该 scope
    this.registry.delete(scope);

    if (errors.length > 0) {
      this.logger.warn(`Cleanup for scope "${scope}" completed with ${errors.length} errors`);
    } else {
      this.logger.log(`Cleanup for scope "${scope}" completed successfully`);
    }
  }

  /**
   * 清理指定 scope 下的所有可清理对象（同步版本）
   * 用于不需要等待异步清理完成的场景
   * @param scope 清理范围标识
   */
  cleanupSync(scope: string): void {
    const set = this.registry.get(scope);
    if (!set || set.size === 0) {
      return;
    }

    for (const item of set) {
      try {
        item.cleanup();
      } catch (err: any) {
        this.logger.error(`Sync cleanup error in scope ${scope}: ${err?.message || err}`);
      }
    }

    this.registry.delete(scope);
  }

  // ==================== 预设场景便捷方法 ====================

  /**
   * 插件卸载时调用
   * 清理该插件注册的所有可清理对象
   * @param pluginId 插件ID
   */
  async cleanupForPlugin(pluginId: string): Promise<void> {
    await this.cleanup(`plugin:${pluginId}`);
  }

  /**
   * 玩家断线时调用
   * 清理该玩家相关的所有可清理对象
   * @param playerId 玩家ID
   */
  async cleanupForPlayer(playerId: string): Promise<void> {
    await this.cleanup(`player:${playerId}`);
  }

  /**
   * 房间解散时调用
   * 清理该房间相关的所有可清理对象
   * @param roomId 房间ID
   */
  async cleanupForRoom(roomId: string): Promise<void> {
    await this.cleanup(`room:${roomId}`);
  }

  // ==================== 查询接口 ====================

  /**
   * 获取指定 scope 的注册对象数量
   * @param scope 清理范围标识
   * @returns 注册对象数量
   */
  getScopeSize(scope: string): number {
    return this.registry.get(scope)?.size ?? 0;
  }

  /**
   * 获取所有已注册的 scope 列表
   * @returns scope 名称数组
   */
  getScopes(): string[] {
    return Array.from(this.registry.keys());
  }

  /**
   * 获取总注册对象数量
   * @returns 所有 scope 中的对象总数
   */
  getTotalCount(): number {
    let total = 0;
    for (const set of this.registry.values()) {
      total += set.size;
    }
    return total;
  }

  /**
   * 检查指定 scope 是否有注册对象
   * @param scope 清理范围标识
   * @returns 是否有注册对象
   */
  hasScope(scope: string): boolean {
    return this.registry.has(scope) && this.registry.get(scope)!.size > 0;
  }

  // ==================== 生命周期钩子 ====================

  /**
   * 模块销毁时清理所有未清理的对象
   */
  onModuleDestroy(): void {
    const scopes = Array.from(this.registry.keys());
    if (scopes.length === 0) return;

    this.logger.log(`Module destroying, cleaning up ${scopes.length} scopes`);

    for (const scope of scopes) {
      try {
        this.cleanupSync(scope);
      } catch (err: any) {
        this.logger.error(`Error during module destroy cleanup for scope ${scope}: ${err?.message}`);
      }
    }

    this.registry.clear();
  }
}
