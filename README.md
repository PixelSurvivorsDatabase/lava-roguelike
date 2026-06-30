# Lava Roguelike: Stormforge Abyss

A 3D browser roguelike prototype built with Three.js + Vite.

You play as the **Riftborn Stormforge**, starting as a Stormblade with dash-heavy combat. Clear arenas, collect Lava Coins and Abyss Shards, choose relics, survive weather disasters, and push toward boss rooms.

## v0.1 features

- 3D arena with third-person camera
- WASD movement and mouse aiming
- M1 slash attack
- Shift dash
- Q Thunder Dash
- Unlockable E Hyper Beam relic
- Enemy waves: Ash Slimes, Storm Bats, Rust Drones
- Elite enemy modifiers
- Boss room: The Winged Siren
- Lava Coins and Abyss Shards
- Relic reward system
- Weather events: lightning outbreak, meteor rain, ashfall
- Permanent upgrades saved in localStorage
- GitHub Pages-friendly Vite setup

## Controls

| Action | Key |
| --- | --- |
| Move | WASD |
| Aim | Mouse |
| Slash | Left Click |
| Dash | Shift |
| Thunder Dash | Q |
| Hyper Beam | E, after finding Hyper Beam Core |

## Run locally

```bash
npm install
npm run dev
```

Then open the local URL Vite prints in your terminal.

## Build

```bash
npm run build
```

The production build outputs to `dist/`.

## Roadmap

### v0.2

- Random connected rooms instead of one arena loop
- Shop room with Vrotato Chip
- Lava Gunner and Beast Tamer starter classes
- More relic combos
- Companion prototype: Lava Axolotl

### v0.3

- Proper floor themes
- More bosses
- Save file menu
- Boss intro cards
- More weather disasters

### v0.4+

- Mech/Titan Pilot class
- Void powers and gravity combos
- Full build evolution system
- Story rooms and Codex Buddy dialogue trees
