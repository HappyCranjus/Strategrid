# Where to See Training Stats

## Total Games Trained - Quick Answer

**Location**: In the **Training Progress** panel when training is active

**Look for**: The large green number in a box labeled "Total Games Played (All Time)"

This counter shows:

- ✅ Total games across ALL training sessions (not just current session)
- ✅ Updates immediately after each game ends
- ✅ Persists across browser sessions
- ✅ Large, easy-to-read display (32px font)

## Full Training Stats Locations

### 1. **Prominent Counter** (Most Visible)

- **Where**: Top of Training Progress panel
- **What**: Large green number showing total games
- **When**: Visible during active training
- **Updates**: Immediately after each game

### 2. **Detailed Stats Panel**

- **Where**: Below the progress bar in Training Progress panel
- **Shows**:
  - Games Played (Total): Same as the big counter
  - Exploration Rate: Current exploration percentage
  - Last Game Result: Win/Loss with color coding

### 3. **Progress Bar**

- **Where**: Above the detailed stats
- **Shows**: Current session progress (e.g., "5/10 games")
- **Note**: This is session-specific, not total games

### 4. **Browser Console**

- **Command**: Type `checkRLTraining()` and press Enter
- **Shows**: Complete training status including total games

### 5. **View Model Weights Button**

- **Where**: In Training Progress panel
- **Shows**: Popup with weights + total games in the header

## Visual Guide

When training is active, you'll see:

```
┌─────────────────────────────────┐
│  Total Games Played (All Time) │
│            [ 42 ]               │  ← This is your total games!
└─────────────────────────────────┘
Training Progress: 5/10
[Progress Bar]
Games Played (Total): 42
Exploration Rate: 25.0%
Last Game Result: Won
```

## Notes

- The **large counter** is the easiest way to see total games at a glance
- It updates **immediately** after each game ends
- The number **persists** across training sessions
- If you see the number **incrementing**, the AI is learning from new games!
