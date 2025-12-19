# Unit Balance Analysis

## Unit Stats Summary

### Melee Units

| Unit          | Cost | HP  | Damage | Attack Speed | DPS  | Range | Speed                    | Special                                       |
| ------------- | ---- | --- | ------ | ------------ | ---- | ----- | ------------------------ | --------------------------------------------- |
| **Swordsman** | 1.0  | 45  | 23     | 1.2          | 27.6 | 0.5   | 0.25                     | Parry (10 dmg mitigation, 2s CD)              |
| **Militia**   | 0.5  | 25  | 3      | 1.8          | 5.4  | 0.6   | 0.3                      | Fast activation (1s)                          |
| **Brute**     | 3.0  | 70  | 25     | 0.33         | 8.25 | 0.75  | 0.2 (1.0 when targeting) | Armor: 2 flat + 50% (35 EHP), Speed boost     |
| **Heavy**     | 3.0  | 100 | 55     | 0.5          | 27.5 | 1.0   | 0.1                      | Armor: 2 flat + 70% (200 EHP), Charge ability |
| **Engineer**  | 2.0  | 40  | 8      | 1.2          | 9.6  | 0.6   | 0.3                      | -                                             |

### Ranged Units

| Unit         | Cost | HP  | Damage | Attack Speed | DPS  | Range | Speed              | Special                                                |
| ------------ | ---- | --- | ------ | ------------ | ---- | ----- | ------------------ | ------------------------------------------------------ |
| **Archer**   | 1.5  | 22  | 4      | 1.0          | 4.0  | 6.0   | 0.15 (0.1 retreat) | Tactical retreat                                       |
| **Sentinel** | 2.5  | 35  | 2      | 5.0          | 10.0 | 3.75  | 1.25               | Armor: 0 flat + 50% (50 EHP), 30 ammo, reload mechanic |

### Utility Units

| Unit         | Cost | HP  | Damage | Speed | Special                       |
| ------------ | ---- | --- | ------ | ----- | ----------------------------- |
| **Settler**  | 1.5  | 20  | 0      | 2.5   | Builds buildings              |
| **Skeleton** | 0.2  | 25  | 5      | 1.5   | 7.5 DPS, 0.6 range, 0.4 speed |

---

## Key Metrics Analysis

### DPS per Cost (Efficiency)

1. **Skeleton**: 37.5 DPS/cost ⚠️ (Extremely high - likely overpowered)
2. **Militia**: 10.8 DPS/cost
3. **Swordsman**: 27.6 DPS/cost
4. **Archer**: 2.67 DPS/cost ⚠️ (Very low)
5. **Sentinel**: 4.0 DPS/cost ⚠️ (Low for cost)
6. **Brute**: 2.75 DPS/cost ⚠️ (Very low)
7. **Heavy**: 9.17 DPS/cost
8. **Engineer**: 4.8 DPS/cost

### HP per Cost (Durability)

1. **Skeleton**: 125 HP/cost ⚠️ (Extremely high)
2. **Militia**: 50 HP/cost
3. **Swordsman**: 45 HP/cost
4. **Archer**: 14.67 HP/cost ⚠️ (Very fragile)
5. **Sentinel**: 14 HP/cost ⚠️ (Fragile)
6. **Brute**: 23.33 HP/cost (with armor: ~31.67 EHP/cost)
7. **Heavy**: 33.33 HP/cost (with armor: ~100 EHP/cost) ✅
8. **Engineer**: 20 HP/cost

### Effective HP (EHP) for Armored Units

- **Brute**: 70 HP + 35 armor = **105 EHP** (35% more)
- **Heavy**: 100 HP + 200 armor = **300 EHP** (200% more) ✅
- **Sentinel**: 35 HP + 50 armor = **85 EHP** (143% more)

### Time to Kill (TTK) Analysis

**Swordsman (45 HP) vs various attackers:**

- vs Swordsman: 45 / 27.6 = **1.63s**
- vs Militia: 45 / 5.4 = **8.33s** ⚠️ (Very long)
- vs Archer: 45 / 4.0 = **11.25s** ⚠️ (Extremely long)
- vs Heavy: 45 / 27.5 = **1.64s**
- vs Brute: 45 / 8.25 = **5.45s**

**Archer (22 HP) vs various attackers:**

- vs Swordsman: 22 / 27.6 = **0.80s** ⚠️ (Dies very fast)
- vs Archer: 22 / 4.0 = **5.5s**
- vs Militia: 22 / 5.4 = **4.07s**

**Heavy (300 EHP) vs various attackers:**

- vs Swordsman: 300 / 27.6 = **10.87s**
- vs Heavy: 300 / 27.5 = **10.91s**
- vs Archer: 300 / 4.0 = **75s** ⚠️ (Archers are useless vs Heavy)

---

## Balance Issues Identified

### 🔴 Critical Issues

1. **Skeleton is Extremely Overpowered**

   - 37.5 DPS/cost (highest by far)
   - 125 HP/cost (highest by far)
   - 0.2 cost makes it spammable
   - **Recommendation**: Increase cost to 0.5-0.75 or reduce stats significantly

2. **Archer is Severely Underpowered**

   - Only 2.67 DPS/cost (lowest among combat units)
   - 14.67 HP/cost (very fragile)
   - Takes 11.25s to kill a single swordsman
   - Cannot effectively damage Heavy units (75s TTK)
   - **Recommendation**: Increase damage to 6-8 or attack speed to 1.5-2.0

3. **Brute has Poor DPS Efficiency**
   - 2.75 DPS/cost (very low)
   - Speed boost helps, but base DPS is weak
   - **Recommendation**: Increase attack speed to 0.5-0.6 or damage to 30-35

### 🟡 Moderate Issues

4. **Sentinel DPS is Low for Cost**

   - 4.0 DPS/cost (low for 2.5 cost unit)
   - High attack speed (5.0) but low damage (2) means overkill waste
   - **Recommendation**: Increase damage to 3-4 or reduce cost to 2.0

5. **Militia vs Swordsman Mismatch**

   - Militia takes 8.33s to kill Swordsman (too long)
   - But Militia is meant to be cheap, so this might be intentional
   - **Recommendation**: Consider if this is acceptable for a 0.5 cost unit

6. **Heavy vs Archer Interaction**
   - Archers take 75s to kill a Heavy (completely ineffective)
   - Heavy's armor makes it nearly immune to low-damage attacks
   - **Recommendation**: This might be intentional, but consider if archers should have armor penetration

### 🟢 Minor Observations

7. **Engineer Role Unclear**

   - Stats are mediocre (4.8 DPS/cost, 20 HP/cost)
   - No special abilities listed
   - **Recommendation**: Clarify engineer's role or buff stats

8. **Swordsman is Well-Balanced**
   - Good DPS/cost (27.6)
   - Decent HP/cost (45)
   - Parry adds defensive value
   - ✅ This unit seems well-tuned

---

## Recommended Changes

### Priority 1 (Critical)

1. **Skeleton**: Increase cost from 0.2 → 0.5, or reduce HP to 15 and damage to 3
2. **Archer**: Increase damage from 4 → 7, or attack speed from 1.0 → 1.5
3. **Brute**: Increase attack speed from 0.33 → 0.5 (DPS: 8.25 → 12.5)

### Priority 2 (Moderate)

4. **Sentinel**: Increase damage from 2 → 3.5 (DPS: 10 → 17.5)
5. **Engineer**: Clarify role or buff to match cost (suggest 10 damage or 1.5 attack speed)

### Priority 3 (Fine-tuning)

6. Consider giving archers slight armor penetration (10-20%) vs Heavy units
7. Review Militia's role - if it's meant to be a cheap swarm unit, current stats might be fine

---

## Cost Efficiency Rankings

### Best Value Units (DPS + HP per cost)

1. Skeleton ⚠️ (overpowered)
2. Swordsman ✅
3. Militia
4. Heavy ✅
5. Engineer
6. Sentinel
7. Brute ⚠️
8. Archer ⚠️

### Tankiness Rankings (EHP per cost)

1. Heavy ✅ (100 EHP/cost with armor)
2. Skeleton ⚠️ (125 HP/cost)
3. Militia (50 HP/cost)
4. Swordsman (45 HP/cost)
5. Brute (~35 EHP/cost)
6. Engineer (20 HP/cost)
7. Sentinel (~34 EHP/cost)
8. Archer (14.67 HP/cost) ⚠️

---

## Overall Assessment

**Strengths:**

- Heavy and Swordsman are well-balanced
- Good variety in unit roles
- Armor system adds depth

**Weaknesses:**

- Skeleton is game-breakingly efficient
- Archer is too weak for its cost
- Brute's DPS doesn't match its cost
- Some units lack clear role definition

**Recommendation**: Focus on fixing the three critical issues (Skeleton, Archer, Brute) first, as these will have the biggest impact on game balance.
