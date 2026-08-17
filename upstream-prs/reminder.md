# Rappel groupé — PR upstream (prêt à poster)

## Timing recommandé

Le mainteneur (redphx) répond en **semaines/mois** — pas en heures :

| PR | Ouverte | Attente avant rappel raisonnable |
|---|---|---|
| #993 codecProfile lazy | 17 août 20:02 UTC | **≥ 7 jours** (24 août) |
| #994 USM 4 taps | 17 août 20:19 UTC | idem |
| #995 updateCanvas dirty flag | 17 août 20:30 UTC | idem |
| #996 texStorage/RGB8 | 17 août 20:46 UTC | idem |
| #997 viewport + NoColor | 17 août 21:17 UTC | idem |
| #998 hidden throttle | 17 août 21:23 UTC | idem |

Contexte : #468 (record) ouverte depuis **juillet 2024**, #851 depuis
**décembre 2025**, #908 depuis **mars 2026** — toutes sans merge. Dernier
commit du mainteneur sur `typescript` : **14 juillet 2026** (bump 6.7.12).
Un ping à +3-5 h serait perçu comme de l'impatience et contre-productif.

**Décision** : ne PAS poster avant le 24 août. Si toujours aucun retour le
24 août, poster UN commentaire sur **#993** (la plus ancienne) qui référence
les 6 PR — un seul commentaire, pas 6.

## Commentaire groupé (prêt, en anglais)

> Hi, gentle bump on these five small, independent PRs (all from the same
> `typescript` baseline, each one a single isolated topic, all green):
>
> - **#993** perf(startup): defer `stream.video.codecProfile` computation — moves the
>   WebRTC stack init (~600 ms one-shot on a cold browser) out of page load
>   (cold eval 656.8 → 32.9 ms, **−95 %**)
> - **#994** perf(webgl2): USM shader 9 → 4 texture fetches — draw GPU
>   10.24 → 7.17 µs (**−30 %**), visual equivalence verified pixel-by-pixel
> - **#995** perf(webgl2): dirty-flag skip in `updateCanvas` — 7 `gl.uniform*`
>   + 7 `getUniformLocation` per refresh → one branch (**×19.4** on the 60 Hz path)
> - **#996** perf(webgl2): `texStorage2D(RGB8)` + `texSubImage2D` — video upload
>   **×5.5**, wall `updateFrame` **×2.8**, also fixes the black renderer when
>   `gl.RGB` is rejected by `texStorage2D` (INVALID_ENUM)
> - **#997** fix(webgl2): correct viewport height (`drawingBufferWidth` was
>   used for both axes), plus an opt-in `WebGL2NoColorConversion` flag (off by
>   default)
> - **#998** perf(stream-stats): throttle the stats tick to 60 s when the tab
>   is hidden (self-rearming setTimeout + visibilitychange refresh)
>
> Happy to rebase, split further, or adjust anything you'd like — just say
> the word.

## Usage

```bash
# le 24 août, si toujours aucun retour :
gh pr comment 993 --repo redphx/better-xcloud --body-file upstream-prs/reminder.md
# (le fichier reminder.md = uniquement la section « Commentaire groupé »)
```
