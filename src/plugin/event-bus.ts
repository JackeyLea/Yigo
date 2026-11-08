import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';

export type EventHandler = (payload: any, eventType?: string) => void | Promise<void>;

export interface SubscribeOptions {
  subscriberId?: string;
  priority?: number;
  once?: boolean;
}

interface Subscription {
  id: string;
  eventType: string;
  handler: EventHandler;
  subscriberId?: string;
  priority: number;
  once: boolean;
  createdAt: number;
}

interface TrieNode {
  children: Map<string, TrieNode>;
  subscriptions: Set<string>;
  wildcardChild?: TrieNode;
  multiWildcardChild?: TrieNode;
}

/**
 * EventBus - 高性能事件总线
 *
 * 使用 Trie 树实现 O(n) 复杂度的通配符匹配，支持:
 * - `*` 匹配单级事件段
 * - `**` 匹配多级事件段
 * - 自动清理（插件卸载/玩家断线/房间解散时自动取消订阅）
 * - 内存防护（订阅上限 1000，WeakRef 自动回收，FinalizationRegistry 清理）
 * - 内存泄漏检测（每60秒扫描已失效的 WeakRef）
 */
@Injectable()
export class EventBus implements OnModuleDestroy {
  private readonly logger = new Logger(EventBus.name);
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly subscriberIndex = new Map<string, Set<string>>();
  private readonly trieRoot: TrieNode;
  private readonly maxSubscriptions: number;
  private subscriptionCount = 0;
  private destroyed = false;

  // ========== WeakRef 内存防护 ==========
  /**
   * WeakRef 映射表：subscriptionId -> WeakRef(handler)
   * 用于在 handler 被 GC 时自动清理订阅，防止内存泄漏
   */
  private readonly weakRefMap = new Map<string, WeakRef<EventHandler>>();

  /**
   * FinalizationRegistry：当 handler 对象被垃圾回收时自动清理对应订阅
   */
  private readonly finalizationRegistry = new FinalizationRegistry<string>((subscriptionId) => {
    this.unsubscribe(subscriptionId);
    this.weakRefMap.delete(subscriptionId);
    this.logger.debug(`Auto-cleaned subscription ${subscriptionId} due to GC`);
  });

  // ========== 内存泄漏检测定时器 ==========
  /**
   * 定时扫描已失效的 WeakRef，清理死订阅
   */
  private leakCheckTimer?: ReturnType<typeof setInterval>;
  /** 泄漏检测间隔（毫秒） */
  private readonly LEAK_CHECK_INTERVAL_MS = 60000;

  constructor() {
    this.trieRoot = this.createTrieNode();
    this.maxSubscriptions = 1000;
    this.startLeakDetection();
  }

  onModuleDestroy(): void {
    this.destroyed = true;

    // 停止泄漏检测定时器
    if (this.leakCheckTimer) {
      clearInterval(this.leakCheckTimer);
      this.leakCheckTimer = undefined;
    }

    this.subscriptions.clear();
    this.subscriberIndex.clear();
    this.weakRefMap.clear();
    this.trieRoot.children.clear();
    this.trieRoot.subscriptions.clear();
    this.subscriptionCount = 0;
  }

  // ==================== 内存泄漏检测 ====================

  /**
   * 启动内存泄漏检测定时器
   * 每60秒扫描一次 WeakRefMap，清理已被 GC 的 handler 对应的订阅
   */
  private startLeakDetection(): void {
    this.leakCheckTimer = setInterval(() => {
      if (this.destroyed) return;

      let cleaned = 0;
      for (const [id, weakRef] of this.weakRefMap) {
        if (!weakRef.deref()) {
          // handler 已被 GC
          this.unsubscribe(id);
          this.weakRefMap.delete(id);
          cleaned++;
        }
      }

      if (cleaned > 0) {
        this.logger.warn(`Leak detection cleaned ${cleaned} dead subscriptions`);
      }
    }, this.LEAK_CHECK_INTERVAL_MS);

    // 确保定时器不会阻止进程退出
    if ((this.leakCheckTimer as any).unref) {
      (this.leakCheckTimer as any).unref();
    }
  }

  // ==================== 订阅管理 ====================

  /**
   * 订阅事件
   * @param eventType 事件类型，支持 `*` 和 `**` 通配符（使用冒号 `:` 分隔）
   * @param handler 事件处理器
   * @param options 订阅选项
   * @returns 订阅ID
   */
  subscribe(
    eventType: string,
    handler: EventHandler,
    options?: SubscribeOptions,
  ): string {
    if (this.destroyed) {
      throw new Error('EventBus has been destroyed');
    }

    if (!eventType || typeof handler !== 'function') {
      throw new Error('Invalid eventType or handler');
    }

    if (this.subscriptionCount >= this.maxSubscriptions) {
      this.logger.warn(
        `Subscription limit (${this.maxSubscriptions}) reached, rejecting new subscription for ${eventType}`,
      );
      throw new Error(
        `Maximum subscription limit (${this.maxSubscriptions}) reached`,
      );
    }

    const subscriptionId = uuidv4();
    const subscriberId = options?.subscriberId;

    const subscription: Subscription = {
      id: subscriptionId,
      eventType,
      handler,
      subscriberId,
      priority: options?.priority ?? 0,
      once: options?.once ?? false,
      createdAt: Date.now(),
    };

    this.subscriptions.set(subscriptionId, subscription);
    this.insertToTrie(eventType, subscriptionId);

    // ========== WeakRef 注册 ==========
    // 用 WeakRef 包装 handler，不阻止垃圾回收
    const weakRef = new WeakRef(handler);
    this.weakRefMap.set(subscriptionId, weakRef);
    // 向 FinalizationRegistry 注册 handler 对象，GC 时自动回调清理
    this.finalizationRegistry.register(handler, subscriptionId);

    if (subscriberId) {
      if (!this.subscriberIndex.has(subscriberId)) {
        this.subscriberIndex.set(subscriberId, new Set());
      }
      this.subscriberIndex.get(subscriberId)!.add(subscriptionId);
    }

    this.subscriptionCount++;
    this.logger.debug(`Subscribed [${subscriptionId}] to "${eventType}"`);
    return subscriptionId;
  }

  /**
   * 一次性订阅，触发后自动取消
   */
  subscribeOnce(eventType: string, handler: EventHandler): string {
    return this.subscribe(eventType, handler, { once: true });
  }

  /**
   * 取消单个订阅
   */
  unsubscribe(subscriptionId: string): void {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) return;

    this.removeFromTrie(subscription.eventType, subscriptionId);
    this.subscriptions.delete(subscriptionId);

    // 清理 WeakRef 映射
    this.weakRefMap.delete(subscriptionId);

    if (subscription.subscriberId) {
      const subSet = this.subscriberIndex.get(subscription.subscriberId);
      if (subSet) {
        subSet.delete(subscriptionId);
        if (subSet.size === 0) {
          this.subscriberIndex.delete(subscription.subscriberId);
        }
      }
    }

    this.subscriptionCount--;
    this.logger.debug(`Unsubscribed [${subscriptionId}]`);
  }

  /**
   * 取消指定订阅者的所有订阅
   */
  unsubscribeAll(subscriberId: string): void {
    const subSet = this.subscriberIndex.get(subscriberId);
    if (!subSet) return;

    const ids = Array.from(subSet);
    for (const subscriptionId of ids) {
      this.unsubscribe(subscriptionId);
    }
  }

  // ==================== 批量清理接口 ====================

  /**
   * 按订阅者 ID 清理所有订阅
   * 用于：插件卸载、玩家断线等场景
   * @param subscriberId 订阅者标识（如 pluginId、playerId、socketId）
   * @returns 清理的订阅数量
   */
  cleanupForSubscriber(subscriberId: string): number {
    const subSet = this.subscriberIndex.get(subscriberId);
    if (!subSet || subSet.size === 0) {
      return 0;
    }

    const ids = Array.from(subSet);
    for (const subscriptionId of ids) {
      this.unsubscribe(subscriptionId);
    }

    this.logger.log(`Cleaned ${ids.length} subscriptions for subscriber "${subscriberId}"`);
    return ids.length;
  }

  /**
   * 按事件类型模式清理匹配的订阅
   * 用于：房间解散时清理该房间相关的所有订阅
   * @param pattern 事件类型模式，支持 `*` 和 `**` 通配符（使用冒号 `:` 分隔）
   * @returns 清理的订阅数量
   */
  cleanupForPattern(pattern: string): number {
    let cleaned = 0;
    const patternSegments = pattern.split(':');

    // 遍历所有订阅，删除匹配指定 pattern 的
    const allIds = Array.from(this.subscriptions.keys());
    for (const id of allIds) {
      const sub = this.subscriptions.get(id);
      if (!sub) continue;

      const subSegments = sub.eventType.split(':');
      if (this.patternMatch(patternSegments, subSegments)) {
        this.unsubscribe(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.log(`Cleaned ${cleaned} subscriptions for pattern "${pattern}"`);
    }
    return cleaned;
  }

  /**
   * 模式匹配：支持 `*` 单级通配符和 `**` 多级通配符
   * @param patternSegments 模式段数组
   * @param targetSegments 目标段数组
   * @returns 是否匹配
   */
  private patternMatch(patternSegments: string[], targetSegments: string[]): boolean {
    let pi = 0; // pattern index
    let ti = 0; // target index

    while (pi < patternSegments.length && ti < targetSegments.length) {
      // ** 匹配任意多级（包括零级）
      if (patternSegments[pi] === '**') {
        return true;
      }
      // * 匹配单级任意
      if (patternSegments[pi] !== '*' && patternSegments[pi] !== targetSegments[ti]) {
        return false;
      }
      pi++;
      ti++;
    }

    // 处理尾部 ** 匹配空的情况
    if (pi < patternSegments.length && patternSegments[pi] === '**') {
      return true;
    }

    return pi >= patternSegments.length && ti >= targetSegments.length;
  }

  // ==================== 事件发布 ====================

  /**
   * 发布事件到所有匹配的订阅者
   */
  publish(eventType: string, payload: any): void {
    if (this.destroyed) return;

    const matchedIds = this.matchFromTrie(eventType);
    const matchedSubs: Subscription[] = [];

    for (const id of matchedIds) {
      const sub = this.subscriptions.get(id);
      // 额外检查 WeakRef 是否仍然有效
      const weakRef = this.weakRefMap.get(id);
      if (sub && (!weakRef || weakRef.deref())) {
        matchedSubs.push(sub);
      } else if (sub && weakRef && !weakRef.deref()) {
        // handler 已被 GC，标记待清理
        this.unsubscribe(id);
        this.weakRefMap.delete(id);
      }
    }

    // 按优先级排序（高优先级先执行）
    matchedSubs.sort((a, b) => b.priority - a.priority);

    for (const sub of matchedSubs) {
      try {
        const result = sub.handler(payload, eventType);
        if (result instanceof Promise) {
          result.catch((err) => {
            this.logger.error(
              `Async handler error for event "${eventType}": ${err?.message || err}`,
            );
          });
        }
      } catch (err: any) {
        this.logger.error(
          `Handler error for event "${eventType}": ${err?.message || err}`,
        );
      }

      if (sub.once) {
        this.unsubscribe(sub.id);
      }
    }
  }

  /**
   * 发布事件到指定房间
   */
  publishToRoom(roomId: string, eventType: string, payload: any): void {
    const roomEventType = `room:${roomId}:${eventType}`;
    this.publish(roomEventType, payload);
  }

  /**
   * 发布事件到指定玩家
   */
  publishToPlayer(playerId: string, eventType: string, payload: any): void {
    const playerEventType = `player:${playerId}:${eventType}`;
    this.publish(playerEventType, payload);
  }

  /**
   * 发布事件到指定插件
   */
  publishToPlugin(pluginId: string, eventType: string, payload: any): void {
    const pluginEventType = `plugin:${pluginId}:${eventType}`;
    this.publish(pluginEventType, payload);
  }

  // ==================== 查询接口 ====================

  /**
   * 获取当前订阅数量
   */
  getSubscriptionCount(): number {
    return this.subscriptionCount;
  }

  /**
   * 获取指定订阅者的订阅数量
   */
  getSubscriberCount(subscriberId: string): number {
    return this.subscriberIndex.get(subscriberId)?.size ?? 0;
  }

  /**
   * 获取内存统计信息
   */
  getMemoryStats(): {
    subscriptionCount: number;
    weakRefCount: number;
    subscriberIndexCount: number;
  } {
    return {
      subscriptionCount: this.subscriptionCount,
      weakRefCount: this.weakRefMap.size,
      subscriberIndexCount: this.subscriberIndex.size,
    };
  }

  // ==================== Trie 树实现 ====================

  private createTrieNode(): TrieNode {
    return {
      children: new Map(),
      subscriptions: new Set(),
    };
  }

  private insertToTrie(eventType: string, subscriptionId: string): void {
    const segments = eventType.split(':');
    let node = this.trieRoot;

    for (const segment of segments) {
      if (segment === '**') {
        if (!node.multiWildcardChild) {
          node.multiWildcardChild = this.createTrieNode();
        }
        node.multiWildcardChild.subscriptions.add(subscriptionId);
        return;
      }

      if (segment === '*') {
        if (!node.wildcardChild) {
          node.wildcardChild = this.createTrieNode();
        }
        node = node.wildcardChild;
      } else {
        if (!node.children.has(segment)) {
          node.children.set(segment, this.createTrieNode());
        }
        node = node.children.get(segment)!;
      }
    }

    node.subscriptions.add(subscriptionId);
  }

  private removeFromTrie(eventType: string, subscriptionId: string): void {
    const segments = eventType.split(':');
    this.removeFromTrieNode(this.trieRoot, segments, 0, subscriptionId);
  }

  private removeFromTrieNode(
    node: TrieNode,
    segments: string[],
    index: number,
    subscriptionId: string,
  ): boolean {
    if (index >= segments.length) {
      node.subscriptions.delete(subscriptionId);
      return node.subscriptions.size === 0 && node.children.size === 0;
    }

    const segment = segments[index];

    if (segment === '**') {
      if (node.multiWildcardChild) {
        node.multiWildcardChild.subscriptions.delete(subscriptionId);
      }
      return false;
    }

    if (segment === '*') {
      if (node.wildcardChild) {
        const shouldDelete = this.removeFromTrieNode(
          node.wildcardChild,
          segments,
          index + 1,
          subscriptionId,
        );
        if (shouldDelete) {
          node.wildcardChild = undefined;
        }
      }
    } else {
      const child = node.children.get(segment);
      if (child) {
        const shouldDelete = this.removeFromTrieNode(
          child,
          segments,
          index + 1,
          subscriptionId,
        );
        if (shouldDelete) {
          node.children.delete(segment);
        }
      }
    }

    return (
      node.subscriptions.size === 0 &&
      node.children.size === 0 &&
      !node.wildcardChild &&
      !node.multiWildcardChild
    );
  }

  private matchFromTrie(eventType: string): Set<string> {
    const segments = eventType.split(':');
    const results = new Set<string>();
    this.matchFromTrieNode(this.trieRoot, segments, 0, results, false);
    return results;
  }

  private matchFromTrieNode(
    node: TrieNode,
    segments: string[],
    index: number,
    results: Set<string>,
    inMultiWildcard: boolean,
  ): void {
    if (!node) return;

    // 收集当前节点的订阅
    if (index === segments.length || inMultiWildcard) {
      for (const id of node.subscriptions) {
        results.add(id);
      }
    }

    // ** 匹配多级
    if (node.multiWildcardChild) {
      for (let i = index; i <= segments.length; i++) {
        this.matchFromTrieNode(
          node.multiWildcardChild,
          segments,
          i,
          results,
          true,
        );
      }
    }

    if (index >= segments.length) return;

    // * 匹配单级
    if (node.wildcardChild) {
      this.matchFromTrieNode(
        node.wildcardChild,
        segments,
        index + 1,
        results,
        false,
      );
    }

    // 精确匹配
    const child = node.children.get(segments[index]);
    if (child) {
      this.matchFromTrieNode(child, segments, index + 1, results, false);
    }
  }
}
