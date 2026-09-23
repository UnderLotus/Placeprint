# Placeprint

A simple tool to pair photos with location tags using Google Maps links.

**[繁體中文](README_TW.md)**

---

After adding a photo, you can adjust it by dragging and zooming with your fingers or mouse.

Place details can be automatically extracted from a Google Maps link. If you want to make changes or fill in missing info, you can edit them manually.
All fields adapt dynamically to the layout, with an extra field to add your social ID.

There is a button at the bottom of the editor to clear all data and start over with one click.

---

For detailed specifications, see [docs/spec.md](docs/spec.md).

---

## Dev

Requires Node.js >= 20.19.0.

```bash
npm ci
npm run dev       # Start dev server
npm test          # Run tests
npm run typecheck # Type check
npm run build     # Production build
```

For the first release, go to repository Settings → Pages and set Source to GitHub Actions. Afterwards, push to the main branch or run the workflow manually to deploy.

---

## License & Credits

Placeprint is released under the GNU GPLv3 license; see [`LICENSE`](LICENSE).

The search and coordinate calibration logic is adapted from [Vela](https://github.com/PimpinPumpkin/Vela).
See [`NOTICE`](NOTICE) for details and attributions.
