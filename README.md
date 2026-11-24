# Image Builder for Minecraft

A Windows app that turns any image into a 3D Minecraft build. Give it a picture of a
house, castle, statue, character or anything else. Claude designs a block-by-block 3D
version, you preview it, and then either:

- **build it yourself on any server** with the Litematica mod (it shows a hologram of the
  build, and the *Litematica Printer* add-on can place blocks for you as you walk around), or
- **let the bot build it**, as a separate bot player or logged in as you while you're away.

## Install

Download **`Image-Builder-Setup-x.y.z.exe`** from the
[latest release](https://github.com/Mclaren97x/minecraft-image-builder/releases/latest) and run it.
Windows SmartScreen may say "Windows protected your PC" because the app isn't
code-signed. Click **More info → Run anyway**.

**Updates are automatic.** The app checks for new versions when it starts and every few
hours, downloads them in the background, and installs them when you close it. A
"Restart now" button installs right away. Your settings and designs are kept.

On first launch, open **Settings** and paste your Anthropic API key (from
https://console.anthropic.com). It's stored encrypted on your computer. Each new design
costs roughly $0.10–$0.50; exporting or rebuilding a saved design is free.

## Make a design

1. **Create:** drop in an image (or paste a link), pick a size, and add notes if you like.
2. Click **Design it**. It takes 1–3 minutes.
3. Look over the 3D preview (drag to rotate, scroll to zoom, use the slider to see each layer).
   The **materials list** shows how many of each block you need, in stacks.

Designs are saved automatically and listed under **My designs**.

## Build on a multiplayer server, playing as yourself (Litematica)

This works while you're playing, on any server that allows the mods.

1. Install Fabric and the **Litematica** mod (plus **MaLiLib**, which it needs) for your
   Minecraft version. To have blocks placed automatically, also install **Litematica
   Printer**.
2. In the app, open your design and click **Export for Litematica**. It saves to
   `.minecraft/schematics`, where Litematica looks.
3. In game: press **M** → *Load Schematics* → pick the file → *Load*. Move the hologram
   where you want it.
4. **Survival:** gather the blocks on the materials list (Litematica can show the same
   list in game). **Creative:** pick blocks from the creative menu.
5. Build by hand following the hologram, or turn on the Printer and walk around the
   build. It places the blocks from your inventory.

> ⚠️ Many servers ban auto-placing mods like Printer. Check the server's rules first.
> Building by hand from the hologram is allowed almost everywhere.

## Let the bot build

Open the **Bot** page.

| Account | When to use it |
|---|---|
| **Bot account** | Your own LAN world or a server with `online-mode=false`. The bot joins as a separate player with whatever name you give it. |
| **My Microsoft account** | Real servers. The bot logs in **as you**, so **log out of Minecraft first**: one account can't be on a server twice. The first time, a Microsoft sign-in page opens with a code to enter. After that, it stays signed in. |

**Where to build:** in front of the bot (with your account, that's where you logged
out), in front of a player, or at exact coordinates.

**Creative vs survival:** the bot checks its game mode.
- **Creative:** it flies, takes blocks from the creative inventory, and can clear anything in the way.
- **Survival:** it walks and pillars up (using dirt or cobblestone from its inventory),
  places only blocks it's carrying, and never breaks anything. Before you build, the
  Build panel lists which blocks it's missing. Those spots get skipped.

**Chat commands** (optional, in Settings): let one named player control the bot from chat
with `!build <image link>`, `!rebuild <design>`, `!designs` and `!stop`. Replies in chat are
off by default so the bot doesn't spam servers.

## Minecraft versions

The bot supports Minecraft Java **up to 26.1** (and older versions such as 1.21.11).
It can't join 26.2+ servers until its libraries update. Litematica export doesn't have
this limit: it works for any version Litematica supports.

## Limits

- Stairs, slabs and fences come out facing a default direction.
- Survival bot building is slower and less reliable than creative, especially for tall
  builds. Litematica is the better survival option.
- In creative the bot flies in straight lines, 2 blocks above each layer, so hills and
  trees in the area can block it. Flat, open ground works best.

## For developers

```powershell
npm install
npm run app        # run the app without installing
npm run dist       # build the installer into dist/ (no upload)
npm run icon       # render build/icon.svg into build/icon.png and build/icon.ico
npm start          # command-line bot (copy config.example.json to config.json first)
npm run design -- images/castle.png 24   # design from the command line
```

**Shipping an update:** raise `"version"` in `package.json`, commit, then run
`npm run release`. It builds the installer and publishes a GitHub Release using your
`gh` login, and installed apps update themselves from it.

Code: `electron/` is the app shell, `ui/` is the window, `src/designer.js` is the Claude
design step, `src/builder.js` places blocks, `src/session.js` is the bot connection, and
`src/litematic.js` writes the schematic.
