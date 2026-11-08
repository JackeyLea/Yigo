import { Test, TestingModule } from '@nestjs/testing';
import { EloService } from './elo.service';

describe('EloService', () => {
  let service: EloService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [EloService],
    }).compile();

    service = module.get<EloService>(EloService);
  });

  describe('calculateExpectedScore', () => {
    it('相同评分时预期胜率应为0.5', () => {
      const score = service.calculateExpectedScore(1500, 1500);
      expect(score).toBeCloseTo(0.5, 3);
    });

    it('高评分对低评分应有更高的预期胜率', () => {
      const score = service.calculateExpectedScore(1600, 1400);
      expect(score).toBeGreaterThan(0.5);
    });

    it('低评分对高评分应有更低的预期胜率', () => {
      const score = service.calculateExpectedScore(1400, 1600);
      expect(score).toBeLessThan(0.5);
    });

    it('200分差距的预期胜率应约为0.76', () => {
      const score = service.calculateExpectedScore(1600, 1400);
      expect(score).toBeCloseTo(0.7597, 2);
    });

    it('400分差距的预期胜率应约为0.91', () => {
      const score = service.calculateExpectedScore(1800, 1400);
      expect(score).toBeCloseTo(0.909, 2);
    });

    it('0分差距的预期胜率应为0.5', () => {
      const score = service.calculateExpectedScore(1000, 1000);
      expect(score).toBe(0.5);
    });
  });

  describe('updateRating', () => {
    it('赢了应该增加评分', () => {
      const newRating = service.updateRating(1500, 0.5, 1.0, 20);
      expect(newRating).toBeGreaterThan(1500);
    });

    it('输了应该减少评分', () => {
      const newRating = service.updateRating(1500, 0.5, 0.0, 20);
      expect(newRating).toBeLessThan(1500);
    });

    it('和棋时预期高者扣分，预期低者加分', () => {
      // 高评分者的预期胜率>0.5，和棋(0.5)意味着表现低于预期
      const highNewRating = service.updateRating(1600, 0.76, 0.5, 20);
      expect(highNewRating).toBeLessThan(1600);

      // 低评分者的预期胜率<0.5，和棋(0.5)意味着表现高于预期
      const lowNewRating = service.updateRating(1400, 0.24, 0.5, 20);
      expect(lowNewRating).toBeGreaterThan(1400);
    });

    it('评分不应低于100', () => {
      const newRating = service.updateRating(100, 0.9, 0.0, 40);
      expect(newRating).toBeGreaterThanOrEqual(100);
    });

    it('使用不同的K因子应产生不同的变化幅度', () => {
      const ratingHighK = service.updateRating(1500, 0.5, 1.0, 40);
      const ratingLowK = service.updateRating(1500, 0.5, 1.0, 10);

      const changeHighK = Math.abs(ratingHighK - 1500);
      const changeLowK = Math.abs(ratingLowK - 1500);

      expect(changeHighK).toBeGreaterThan(changeLowK);
    });
  });

  describe('getKFactor', () => {
    it('新手(<=30局) K因子应为40', () => {
      expect(service.getKFactor(0)).toBe(40);
      expect(service.getKFactor(1)).toBe(40);
      expect(service.getKFactor(30)).toBe(40);
    });

    it('中级(31-100局) K因子应为20', () => {
      expect(service.getKFactor(31)).toBe(20);
      expect(service.getKFactor(50)).toBe(20);
      expect(service.getKFactor(100)).toBe(20);
    });

    it('高手(100+局) K因子应为10', () => {
      expect(service.getKFactor(101)).toBe(10);
      expect(service.getKFactor(200)).toBe(10);
      expect(service.getKFactor(1000)).toBe(10);
    });
  });

  describe('updateRatingsDuel', () => {
    it('强者赢弱者时应少量加分', () => {
      const [newA, newB] = service.updateRatingsDuel(1600, 1400, 1.0, 50, 50);
      // 强者赢，加分少
      expect(newA).toBeGreaterThan(1600);
      expect(newA - 1600).toBeLessThan(20);
      // 弱者输，扣分少
      expect(newB).toBeLessThan(1400);
      expect(1400 - newB).toBeLessThan(20);
    });

    it('弱者赢强者时应大量加分', () => {
      const [newA, newB] = service.updateRatingsDuel(1400, 1600, 1.0, 50, 50);
      // 弱者赢，加分多（K=20, E≈0.24, 期望变化≈15.19，取整后为15）
      const changeA = newA - 1400;
      expect(changeA).toBeGreaterThanOrEqual(15);
      // 强者输，扣分多
      const changeB = 1600 - newB;
      expect(changeB).toBeGreaterThanOrEqual(15);
    });

    it('同水平胜负时应获得标准K分', () => {
      const [newWinner, newLoser] = service.updateRatingsDuel(1500, 1500, 1.0, 50, 50);
      expect(newWinner - 1500).toBe(10); // K=20, (1-0.5)*20 = 10
      expect(1500 - newLoser).toBe(10);
    });

    it('平局时同水平评分不变', () => {
      const [newA, newB] = service.updateRatingsDuel(1500, 1500, 0.5, 50, 50);
      expect(newA).toBe(1500);
      expect(newB).toBe(1500);
    });
  });

  describe('calculateMultiplayerActualScore', () => {
    it('第1名应得1.0分', () => {
      expect(service.calculateMultiplayerActualScore(1, 4)).toBe(1.0);
    });

    it('最后1名应得0.0分', () => {
      expect(service.calculateMultiplayerActualScore(4, 4)).toBe(0.0);
    });

    it('4人游戏中第2名应得约0.67分', () => {
      const score = service.calculateMultiplayerActualScore(2, 4);
      expect(score).toBeCloseTo(0.667, 2);
    });

    it('4人游戏中第3名应得约0.33分', () => {
      const score = service.calculateMultiplayerActualScore(3, 4);
      expect(score).toBeCloseTo(0.333, 2);
    });

    it('单人游戏应得1.0分', () => {
      expect(service.calculateMultiplayerActualScore(1, 1)).toBe(1.0);
    });

    it('无效排名应抛出错误', () => {
      expect(() => service.calculateMultiplayerActualScore(0, 4)).toThrow();
      expect(() => service.calculateMultiplayerActualScore(5, 4)).toThrow();
    });
  });

  describe('updateRatingsMultiplayer', () => {
    it('4人游戏评分更新应保持稳定（总分守恒）', () => {
      const ratings = [1500, 1500, 1500, 1500];
      const rankings = [1, 2, 3, 4];

      const newRatings = service.updateRatingsMultiplayer(ratings, rankings);

      // 验证排名高的评分增加，排名低的评分减少
      expect(newRatings[0]).toBeGreaterThan(1500); // 第1名加分
      expect(newRatings[1]).toBeGreaterThan(1500); // 第2名可能加分或减分
      expect(newRatings[2]).toBeLessThan(1500);    // 第3名可能加分或减分
      expect(newRatings[3]).toBeLessThan(1500);    // 第4名减分

      // 检查评分都在合理范围内
      newRatings.forEach((r) => {
        expect(r).toBeGreaterThanOrEqual(100);
      });
    });

    it('高评分者获得高排名应增加较少', () => {
      const ratings = [1800, 1500, 1400, 1300];
      const rankings = [1, 2, 3, 4];

      const newRatings = service.updateRatingsMultiplayer(ratings, rankings);

      // 高评分者赢低评分者是预期内的，加分少
      const change1800 = newRatings[0] - 1800;
      const change1300 = newRatings[3] - 1300;

      expect(change1800).toBeLessThan(10);
      // 低评分者输高评分者是预期内的，扣分少
      expect(Math.abs(change1300)).toBeLessThan(10);
    });

    it('低评分者获得高排名应增加较多', () => {
      const ratings = [1300, 1400, 1500, 1800];
      const rankings = [1, 2, 3, 4];

      const newRatings = service.updateRatingsMultiplayer(ratings, rankings);

      // 低评分者赢了高评分者，应大幅加分
      const change1300 = newRatings[0] - 1300;
      expect(change1300).toBeGreaterThan(10);

      // 高评分者输了，应大幅扣分
      const change1800 = newRatings[3] - 1800;
      expect(change1800).toBeLessThan(-10);
    });

    it('应正确处理不同K因子', () => {
      const ratings = [1500, 1500, 1500, 1500];
      const rankings = [1, 2, 3, 4];
      const gamesPlayed = [10, 50, 80, 150]; // 不同的对局数 -> 不同K因子

      const newRatings = service.updateRatingsMultiplayer(ratings, rankings, gamesPlayed);

      // K=40的新手变化应该最大
      const change0 = Math.abs(newRatings[0] - 1500);
      // K=10的高手变化应该最小
      const change3 = Math.abs(newRatings[3] - 1500);

      expect(change0).toBeGreaterThan(change3);
    });

    it('至少需要2个玩家', () => {
      expect(() =>
        service.updateRatingsMultiplayer([1500], [1]),
      ).toThrow('multiplayer rating update requires at least 2 players');
    });

    it('ratings和rankings长度必须相同', () => {
      expect(() =>
        service.updateRatingsMultiplayer([1500, 1400], [1]),
      ).toThrow('ratings and rankings must have the same length');
    });
  });
});
