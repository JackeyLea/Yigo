/**
 * EloCalculator Unit Tests - ELO评分计算器单元测试
 */
import { Test, TestingModule } from '@nestjs/testing';
import { EloCalculator, RatingUpdateResult } from './elo-calculator';

describe('EloCalculator', () => {
  let calculator: EloCalculator;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [EloCalculator],
    }).compile();

    calculator = module.get<EloCalculator>(EloCalculator);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================
  // 基础预期胜率计算
  // ============================================================

  describe('calculateExpectedScore', () => {
    it('同等评分时预期胜率应为0.5', () => {
      const result = calculator.calculateExpectedScore(1500, 1500);
      expect(result).toBeCloseTo(0.5, 3);
    });

    it('评分高200分时预期胜率应约为0.76', () => {
      const result = calculator.calculateExpectedScore(1600, 1400);
      expect(result).toBeCloseTo(0.76, 2);
    });

    it('评分低200分时预期胜率应约为0.24', () => {
      const result = calculator.calculateExpectedScore(1400, 1600);
      expect(result).toBeCloseTo(0.24, 2);
    });

    it('评分高400分时预期胜率应约为0.91', () => {
      const result = calculator.calculateExpectedScore(1800, 1400);
      expect(result).toBeCloseTo(0.91, 2);
    });

    it('极端评分差距时预期胜率应接近1', () => {
      const result = calculator.calculateExpectedScore(2800, 1000);
      expect(result).toBeGreaterThan(0.997);
    });

    it('极端评分差距时预期胜率应接近0', () => {
      const result = calculator.calculateExpectedScore(1000, 2800);
      expect(result).toBeLessThan(0.003);
    });
  });

  // ============================================================
  // K因子动态调整
  // ============================================================

  describe('getKFactor', () => {
    it('新手(0局)应使用K=40', () => {
      expect(calculator.getKFactor(0)).toBe(40);
    });

    it('新手(30局)应使用K=40', () => {
      expect(calculator.getKFactor(30)).toBe(40);
    });

    it('中级(31局)应使用K=20', () => {
      expect(calculator.getKFactor(31)).toBe(20);
    });

    it('中级(100局)应使用K=20', () => {
      expect(calculator.getKFactor(100)).toBe(20);
    });

    it('高手(101局)应使用K=10', () => {
      expect(calculator.getKFactor(101)).toBe(10);
    });

    it('高手(500局)应使用K=10', () => {
      expect(calculator.getKFactor(500)).toBe(10);
    });
  });

  // ============================================================
  // 多人游戏实际得分
  // ============================================================

  describe('calculateMultiplayerActualScore', () => {
    it('2人游戏中第1名应得1.0分', () => {
      expect(calculator.calculateMultiplayerActualScore(1, 2)).toBe(1.0);
    });

    it('2人游戏中第2名应得0.0分', () => {
      expect(calculator.calculateMultiplayerActualScore(2, 2)).toBe(0.0);
    });

    it('4人游戏中第1名应得1.0分', () => {
      expect(calculator.calculateMultiplayerActualScore(1, 4)).toBe(1.0);
    });

    it('4人游戏中最后一名应得0.0分', () => {
      expect(calculator.calculateMultiplayerActualScore(4, 4)).toBe(0.0);
    });

    it('1人游戏应得1.0分', () => {
      expect(calculator.calculateMultiplayerActualScore(1, 1)).toBe(1.0);
    });

    it('无效排名应抛出错误', () => {
      expect(() => calculator.calculateMultiplayerActualScore(0, 4)).toThrow();
      expect(() => calculator.calculateMultiplayerActualScore(5, 4)).toThrow();
    });
  });

  // ============================================================
  // 双人ELO计算
  // ============================================================

  describe('calculateDuelRating', () => {
    it('同评分玩家A获胜时，A加分B减分', () => {
      const [resultA, resultB] = calculator.calculateDuelRating(
        { userId: 1, rating: 1500, gamesPlayed: 50, score: 1 },
        { userId: 2, rating: 1500, gamesPlayed: 50, score: 0 },
      );

      expect(resultA.newRating).toBeGreaterThan(1500);
      expect(resultB.newRating).toBeLessThan(1500);
      expect(resultA.ratingChange).toBeGreaterThan(0);
      expect(resultB.ratingChange).toBeLessThan(0);
    });

    it('同评分平局时，双方评分不变', () => {
      const [resultA, resultB] = calculator.calculateDuelRating(
        { userId: 1, rating: 1500, gamesPlayed: 50, score: 0.5 },
        { userId: 2, rating: 1500, gamesPlayed: 50, score: 0.5 },
      );

      expect(resultA.newRating).toBe(1500);
      expect(resultB.newRating).toBe(1500);
    });

    it('低评分玩家战胜高评分玩家应获得大量加分', () => {
      const [resultA, resultB] = calculator.calculateDuelRating(
        { userId: 1, rating: 1200, gamesPlayed: 50, score: 1 },
        { userId: 2, rating: 1800, gamesPlayed: 50, score: 0 },
      );

      // 低评分玩家获胜应获得大量加分
      expect(resultA.ratingChange).toBeGreaterThan(15);
      // 高评分玩家失败应大量减分
      expect(resultB.ratingChange).toBeLessThan(-15);
    });

    it('高评分玩家战胜低评分玩家应获得少量加分', () => {
      const [resultA, resultB] = calculator.calculateDuelRating(
        { userId: 1, rating: 1800, gamesPlayed: 50, score: 1 },
        { userId: 2, rating: 1200, gamesPlayed: 50, score: 0 },
      );

      // 高评分玩家获胜应只获得少量加分
      expect(resultA.ratingChange).toBeLessThan(5);
      expect(resultA.ratingChange).toBeGreaterThan(0);
    });

    it('新手应使用K=40获得更大评分变化', () => {
      const [resultA, resultB] = calculator.calculateDuelRating(
        { userId: 1, rating: 1500, gamesPlayed: 10, score: 1 },
        { userId: 2, rating: 1500, gamesPlayed: 50, score: 0 },
      );

      expect(resultA.kFactor).toBe(40);
      expect(resultB.kFactor).toBe(20);
      expect(Math.abs(resultA.ratingChange)).toBeGreaterThan(Math.abs(resultB.ratingChange));
    });

    it('评分不应低于下限100', () => {
      const [resultA, resultB] = calculator.calculateDuelRating(
        { userId: 1, rating: 100, gamesPlayed: 50, score: 0 },
        { userId: 2, rating: 100, gamesPlayed: 50, score: 1 },
      );

      expect(resultA.newRating).toBeGreaterThanOrEqual(100);
    });

    it('应返回完整的更新结果结构', () => {
      const [resultA] = calculator.calculateDuelRating(
        { userId: 1, rating: 1500, gamesPlayed: 50, score: 1 },
        { userId: 2, rating: 1500, gamesPlayed: 50, score: 0 },
      );

      expect(resultA).toHaveProperty('userId');
      expect(resultA).toHaveProperty('oldRating');
      expect(resultA).toHaveProperty('newRating');
      expect(resultA).toHaveProperty('ratingChange');
      expect(resultA).toHaveProperty('kFactor');
      expect(resultA).toHaveProperty('expectedScore');
      expect(resultA).toHaveProperty('actualScore');
    });
  });

  // ============================================================
  // 多人ELO计算
  // ============================================================

  describe('calculateMultiplayerRating', () => {
    it('4人游戏中第1名应加分', () => {
      const results = calculator.calculateMultiplayerRating([
        { userId: 1, rating: 1500, gamesPlayed: 50, rank: 1 },
        { userId: 2, rating: 1500, gamesPlayed: 50, rank: 2 },
        { userId: 3, rating: 1500, gamesPlayed: 50, rank: 3 },
        { userId: 4, rating: 1500, gamesPlayed: 50, rank: 4 },
      ]);

      expect(results[0].ratingChange).toBeGreaterThan(0); // 第1名加分
      expect(results[3].ratingChange).toBeLessThan(0);    // 最后一名减分
    });

    it('至少需要2个玩家', () => {
      expect(() =>
        calculator.calculateMultiplayerRating([
          { userId: 1, rating: 1500, gamesPlayed: 50, rank: 1 },
        ]),
      ).toThrow('At least 2 players');
    });

    it('应返回所有玩家的结果', () => {
      const results = calculator.calculateMultiplayerRating([
        { userId: 1, rating: 1500, gamesPlayed: 50, rank: 1 },
        { userId: 2, rating: 1500, gamesPlayed: 50, rank: 2 },
        { userId: 3, rating: 1500, gamesPlayed: 50, rank: 3 },
      ]);

      expect(results).toHaveLength(3);
      results.forEach((r) => {
        expect(r).toHaveProperty('userId');
        expect(r).toHaveProperty('newRating');
        expect(r).toHaveProperty('ratingChange');
      });
    });
  });

  // ============================================================
  // 通用入口
  // ============================================================

  describe('calculateRatingUpdates', () => {
    it('2个玩家应使用双人模式', () => {
      const results = calculator.calculateRatingUpdates([
        { userId: 1, rating: 1500, gamesPlayed: 50, rank: 1, score: 1 },
        { userId: 2, rating: 1500, gamesPlayed: 50, rank: 2, score: 0 },
      ]);

      expect(results).toHaveLength(2);
      expect(results[0].ratingChange).toBeGreaterThan(0);
      expect(results[1].ratingChange).toBeLessThan(0);
    });

    it('4个玩家应使用多人模式', () => {
      const results = calculator.calculateRatingUpdates([
        { userId: 1, rating: 1500, gamesPlayed: 50, rank: 1 },
        { userId: 2, rating: 1500, gamesPlayed: 50, rank: 2 },
        { userId: 3, rating: 1500, gamesPlayed: 50, rank: 3 },
        { userId: 4, rating: 1500, gamesPlayed: 50, rank: 4 },
      ]);

      expect(results).toHaveLength(4);
    });

    it('少于2个玩家应抛出错误', () => {
      expect(() =>
        calculator.calculateRatingUpdates([
          { userId: 1, rating: 1500, gamesPlayed: 50, rank: 1 },
        ]),
      ).toThrow('At least 2 players');
    });
  });

  // ============================================================
  // 积分守恒性检查
  // ============================================================

  describe('rating conservation', () => {
    it('同评分双人模式下积分应近似守恒', () => {
      const [resultA, resultB] = calculator.calculateDuelRating(
        { userId: 1, rating: 1500, gamesPlayed: 50, score: 1 },
        { userId: 2, rating: 1500, gamesPlayed: 50, score: 0 },
      );

      // A获得的分数应约等于B失去的分数
      expect(Math.abs(resultA.ratingChange + resultB.ratingChange)).toBeLessThan(2);
    });

    it('同评分4人模式下总分变化应较小', () => {
      const results = calculator.calculateMultiplayerRating([
        { userId: 1, rating: 1500, gamesPlayed: 50, rank: 1 },
        { userId: 2, rating: 1500, gamesPlayed: 50, rank: 2 },
        { userId: 3, rating: 1500, gamesPlayed: 50, rank: 3 },
        { userId: 4, rating: 1500, gamesPlayed: 50, rank: 4 },
      ]);

      const totalChange = results.reduce((sum, r) => sum + r.ratingChange, 0);
      expect(Math.abs(totalChange)).toBeLessThan(5);
    });
  });
});
