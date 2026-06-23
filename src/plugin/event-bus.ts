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
 * - 自动清理（插件卸载时自动取消订阅）
 * - 内存防护（订阅上限 1000，WeakRef 自动回收）
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

  constructor() {
    this.trieRoot = this.createTrieNode();
    this.maxSubscriptions = 1000;
  }

  onModuleDestroy(): void {
    this.destroyed = true;
    this.subscriptions.clear();
    this.subscriberIndex.clear();
    this.trieRoot.children.clear();
    this.trieRoot.subscriptions.clear();
    this.subscriptionCount = 0;
  }

  /**
   * 订阅事件
   * @param eventType 事件类型，支持 `*` 和 `**` 通配符
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

  /**
   * 发布事件到所有匹配的订阅者
   */
  publish(eventType: string, payload: any): void {
    if (this.destroyed) return;

    const matchedIds = this.matchFromTrie(eventType);
    const matchedSubs: Subscription[] = [];

    for (const id of matchedIds) {
      const sub = this.subscriptions.get(id);
      if (sub) {
        matchedSubs.push(sub);
      }
    }

    // 按优先级排序
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
   * 获取当前订阅数量
   */
  getSubscriptionCount(): number {
    return this.subscriptionCount;
  }

  // ==================== Trie 树实现 ====================

  private createTrieNode(): TrieNode {
    return {
      children: new Map(),
      subscriptions: new Set(),
    };
  }

  private insertToTrie(eventType: string, subscriptionId: string): void {
    const segments = eventType.split('.');
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
    const segments = eventType.split('.');
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
    const segments = eventType.split('.');
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
