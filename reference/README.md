# reference/ — 原版数据与逻辑参考文件

来源: [SuperMarioBros-C](https://github.com/MitchellSternke/SuperMarioBros-C)
(smbdis 反汇编的 C++ 翻译版, 仅保留对本项目有用的数据/逻辑文件)。

| 文件 | 用途 |
|---|---|
| `smbdis.asm` | **最权威参考**: 完整带注释的 NES 反汇编。物理常量、元瓦片映射表(Palette0-3_MTiles)、关卡数据标签、音乐引擎全在这里 |
| `SMB.cpp` | 全部游戏逻辑的 C++ 翻译(敌人 AI/碰撞/音乐/流程), 查行为细节用 |
| `SMBData.cpp` | 关卡对象流/敌人流/场景数据表 —— `js/leveldata.js`、`js/leveltables.js` 的提取源 |
| `SMBDataPointers.hpp` | 上述数据表的 ROM 地址(提取脚本用它解析 LOBYTE/HIBYTE/标签差值) |
| `SMBConstants.hpp` | RAM 地址与常量名对照表 |

## 常用查询入口(在 smbdis.asm 中搜索)

- 物理常量: `MaxRightXSpdData` / `JumpMForceData` / `FallMForceData`
- 元瓦片含义: `Palette0_MTiles` ~ `Palette3_MTiles`(带注释)
- 关卡数据: `;GAME LEVELS DATA` 段(`L_GroundArea6` = 1-1 等)
- 音乐/音效数据与引擎: `MusicData` 段

## 从原始数据重新提取关卡

```bash
# 原提取脚本逻辑(见仓库早期提交):
# 1. 用正则从 SMBData.cpp 抓取 E_*/L_*_data[] 数组
# 2. LOBYTE/HIBYTE 与 "LabelA - LabelB" 用 SMBDataPointers.hpp 的地址解析
# 3. 输出 js/leveldata.js (LEVEL_DATA + LEVEL_TABLES)
```
