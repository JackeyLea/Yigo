// 破产补助常量
export const BANKRUPTCY = {
  MIN_BALANCE_THRESHOLD: 100,    // 触发破产补助的最低余额门槛
  RELIEF_AMOUNT: 500,            // 每次补助金额
  MAX_DAILY_CLAIMS: 3,           // 每日最大领取次数
  CLAIM_COOLDOWN_SECONDS: 300,   // 领取间隔5分钟
  DAILY_RESET_HOUR: 4,           // 每日重置时间（凌晨4点）
} as const;

// 抽奖/转盘常量
export const LOTTERY = {
  WHEEL_SLOTS: 8,
  FREE_SPIN_DAILY: 1,            // 每日免费次数
  COIN_COST_PER_SPIN: 100,       // 每次抽奖消耗金币
  JACKPOT_AMOUNT: 5000,          // 大奖金额
  JACKPOT_GUARANTEE: 100,        // 大奖保底次数
  DEFAULT_PRIZES: [
    { id: 'prize_100', name: '100金币', type: 'coins' as const, value: 100, weight: 25, icon: 'coin_100.png' },
    { id: 'prize_500', name: '500金币', type: 'coins' as const, value: 500, weight: 20, icon: 'coin_500.png' },
    { id: 'prize_1000', name: '1000金币', type: 'coins' as const, value: 1000, weight: 15, icon: 'coin_1000.png' },
    { id: 'prize_2000', name: '2000金币', type: 'coins' as const, value: 2000, weight: 10, icon: 'coin_2000.png' },
    { id: 'prize_5000', name: '5000金币', type: 'coins' as const, value: 5000, weight: 5, icon: 'coin_5000.png' },
    { id: 'prize_vip1', name: 'VIP 1天', type: 'vip_day' as const, value: 1, weight: 10, icon: 'vip_1day.png' },
    { id: 'prize_exp2x', name: '双倍经验卡', type: 'item' as const, value: 1, weight: 10, icon: 'exp_2x.png' },
    { id: 'prize_none', name: '谢谢参与', type: 'coins' as const, value: 0, weight: 5, icon: 'thanks.png' },
  ],
} as const;

// VIP体系常量
export const VIP = {
  LEVELS: [
    { level: 0, name: '普通', price: 0, privileges: [] },
    { level: 1, name: '青铜', price: 6800, privileges: ['signin_2x', 'avatar_frame_vip1'] },
    { level: 2, name: '白银', price: 12800, privileges: ['signin_2x', 'avatar_frame_vip1', 'free_spin_2x', 'bankruptcy_plus1'] },
    { level: 3, name: '黄金', price: 19800, privileges: ['signin_2x', 'avatar_frame_vip1', 'free_spin_2x', 'bankruptcy_plus1', 'exclusive_emote', 'exp_50'] },
    { level: 4, name: '铂金', price: 32800, privileges: ['signin_2x', 'avatar_frame_vip1', 'free_spin_2x', 'bankruptcy_plus1', 'exclusive_emote', 'exp_50', 'priority_match', 'vip_room'] },
    { level: 5, name: '钻石', price: 64800, privileges: ['signin_2x', 'avatar_frame_vip1', 'free_spin_2x', 'bankruptcy_plus1', 'exclusive_emote', 'exp_50', 'priority_match', 'vip_room', 'vip_support', 'free_transfer'] },
    { level: 6, name: '至尊', price: 129800, privileges: ['all'] },
  ],
  DURATION_DAYS: 30,
} as const;

// 礼包常量
export const GIFTPACK = {
  PACKS: [
    {
      id: 'newbie_pack',
      name: '新手礼包',
      description: '新手专属，助力起航！',
      type: 'newbie' as const,
      price: 0,
      originalPrice: 6800,
      contents: [
        { type: 'coins' as const, quantity: 1000 },
        { type: 'vip_day' as const, quantity: 1 },
        { type: 'item' as const, itemId: 'room_card', quantity: 3 },
      ],
      limitPerUser: 1,
      bannerImage: 'newbie_banner.png',
    },
    {
      id: 'daily_pack',
      name: '每日礼包',
      description: '每日限购，超值优惠',
      type: 'daily' as const,
      price: 600,
      originalPrice: 1200,
      contents: [
        { type: 'coins' as const, quantity: 6000 },
        { type: 'item' as const, itemId: 'free_spin_ticket', quantity: 1 },
      ],
      limitPerUser: 1,
      bannerImage: 'daily_banner.png',
    },
    {
      id: 'weekly_pack',
      name: '周礼包',
      description: '一周一次，海量金币',
      type: 'weekly' as const,
      price: 3000,
      originalPrice: 6000,
      contents: [
        { type: 'coins' as const, quantity: 30000 },
        { type: 'vip_day' as const, quantity: 3 },
        { type: 'item' as const, itemId: 'room_card', quantity: 10 },
      ],
      limitPerUser: 1,
      bannerImage: 'weekly_banner.png',
    },
    {
      id: 'monthly_pack',
      name: '月礼包',
      description: '月度钜惠，尊享特权',
      type: 'weekly' as const,
      price: 9800,
      originalPrice: 19600,
      contents: [
        { type: 'coins' as const, quantity: 98000 },
        { type: 'vip_day' as const, quantity: 7 },
        { type: 'item' as const, itemId: 'avatar_frame_exclusive', quantity: 1 },
      ],
      limitPerUser: 1,
      bannerImage: 'monthly_banner.png',
    },
  ],
} as const;

// Redis key前缀
export const REDIS_KEYS = {
  // 破产补助
  BANKRUPTCY_CLAIM_COUNT: (userId: number) => `bankruptcy:claims:${userId}`,
  BANKRUPTCY_LAST_CLAIM: (userId: number) => `bankruptcy:last_claim:${userId}`,

  // 抽奖
  LOTTERY_FREE_SPIN: (userId: number) => `lottery:free_spins:${userId}`,
  LOTTERY_JACKPOT_COUNTER: (userId: number) => `lottery:jackpot:${userId}`,
  LOTTERY_TOTAL_SPINS: (userId: number) => `lottery:total:${userId}`,

  // VIP
  VIP_EXPIRE: (userId: number) => `vip:expire:${userId}`,
  VIP_LEVEL: (userId: number) => `vip:level:${userId}`,

  // 礼包
  GIFTPACK_PURCHASED: (userId: number, packId: string) => `giftpack:purchased:${userId}:${packId}`,
  GIFTPACK_DAILY_CLAIMED: (userId: number, packId: string) => `giftpack:daily:${userId}:${packId}`,
} as const;

// 事件名称
export const ECONOMY_EVENTS = {
  RELIEF_CLAIMED: 'economy.relief.claimed',
  SPIN_COMPLETED: 'economy.spin.completed',
  JACKPOT_WON: 'economy.jackpot.won',
  VIP_PURCHASED: 'economy.vip.purchased',
  VIP_EXPIRED: 'economy.vip.expired',
  GIFTPACK_PURCHASED: 'economy.giftpack.purchased',
  GIFTPACK_CLAIMED: 'economy.giftpack.claimed',
  BALANCE_CHANGED: 'economy.balance.changed',
} as const;
