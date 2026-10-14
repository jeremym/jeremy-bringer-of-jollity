# jeremy-bringer-of-jollity

Jeremy Mooer's business card for the terminal.

```sh
npx jeremy-bringer-of-jollity
```

It shows a portrait, then a menu of links:

- Overtone Foundry
- LinkedIn
- GitHub
- Email
- **Music experiment**: a tune written in [Strudel](https://strudel.cc/), played with its code lighting up as it sounds, the same way the Strudel editor highlights it

Press `q` or `Esc` to stop the music.

## Audio

| Platform | Player |
| --- | --- |
| macOS | `afplay` (built in) |
| Windows 10/11 | Windows PowerShell's media player (built in) |
| Linux | `mpg123`, `ffplay`, or `paplay`, whichever is installed |

With no player available, the animation runs silently.

## How it's made

- `media/portrait.json` comes from `art/profile.png` via `pnpm art` (half-block characters, two pixels per cell).
- `media/tune.mp3` and `media/tune.json` are exported from a local Strudel workspace: the audio is rendered offline by Strudel, and the JSON lists every note's start and end time with the code ranges it came from.
