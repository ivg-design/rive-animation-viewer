import Link from "next/link";
import DocsFigure from "@/components/docs/DocsFigure";
import { asset } from "@/lib/config";

export const metadata = { title: "Media Export & Recording" };

export default function MediaExport() {
  return (
    <>
      <h1>Media Export &amp; Recording</h1>

      <p>
        Desktop RAV exports the animation canvas as video, animated images, or still images.
        The media workflow captures Rive output only: application controls and audio are not
        included. Browser RAV does not provide native media export.
      </p>

      <p>
        Open <strong>EXPORT</strong> and choose one of three media workflows. Standalone HTML
        and copy-paste snippets remain a separate fourth choice because they package code rather
        than rendered frames.
      </p>

      <DocsFigure
        src={asset("/docs/2.5.5/export-chooser.webp")}
        alt="RAV Export window with compact cards for still image, timeline, interaction recording, and web code export"
        width={2500}
        height={1800}
        caption="The Export window separates rendered media from standalone HTML and copy-paste code while keeping every workflow in one place."
      />

      <h2>Timeline export</h2>
      <p>
        Select a linear animation, then export its complete authored duration or an exact segment.
        Segment controls accept seconds or zero-based source timeline frames. The start is included
        and the end is excluded, so frames 30–60 contain frames 30 through 59. Output frame rate is
        independent of the timeline&apos;s authored frame rate.
      </p>
      <p>
        Timeline export samples every requested animation frame deterministically. It can encode
        slower than real time on demanding settings, but it does not skip simulation frames to keep
        up with wall time.
      </p>

      <DocsFigure
        src={asset("/docs/2.5.5/timeline-scrubber.webp")}
        alt="RAV timeline scrubber above the status bar paused at frame 30 of 60"
        width={2500}
        height={1800}
        caption="Linear-animation preview shows a full-width frame or seconds ruler above the status bar, with a large draggable current-time indicator."
      />

      <DocsFigure
        src={asset("/docs/2.5.5/timeline-export-settings.webp")}
        alt="RAV timeline export settings showing full-duration range and H.264 output controls"
        width={2500}
        height={1800}
        caption="Timeline export resolves the authored duration, frame count, output dimensions, frame rate, transparency, quality, and destination before capture."
      />

      <h2>Interaction recording</h2>
      <p>
        Select a state machine to record live pointer interaction and ViewModel edits. Recording
        begins from the current state without an implicit reset. Stop manually with the toolbar
        <strong> STOP</strong> control or <code>Cmd/Ctrl+Shift+R</code>, or choose a duration before
        starting. The shortcut is ignored while typing in an input or editor.
      </p>
      <ul>
        <li><strong>Cursor</strong> adds RAV&apos;s tracked canvas pointer to the output.</li>
        <li><strong>ViewModel controls</strong> remain live while the export panel is closed.</li>
        <li><strong>No product time ceiling</strong> applies to manual recording; available disk space is the practical duration limit.</li>
        <li><strong>Frame-complete clock</strong> advances Rive once for every requested output frame. Status reports lag if the device falls behind real time.</li>
      </ul>

      <DocsFigure
        src={asset("/docs/2.5.5/interaction-recording-settings.webp")}
        alt="RAV interaction recording settings with manual stop, output, cursor, and save destination controls"
        width={2500}
        height={1800}
        caption="Interaction recording keeps stop behavior and live-capture guidance beside compact output controls; manual recordings have no product time ceiling."
      />

      <h2>Still image</h2>
      <p>
        Capture the currently visible canvas in either playback mode, or select a precise timeline
        time or frame. PNG and WebP preserve alpha when transparency is enabled. JPG always uses
        the selected matte.
      </p>

      <DocsFigure
        src={asset("/docs/2.5.5/still-image-export-settings.webp")}
        alt="RAV still-image export settings with PNG output selected"
        width={2500}
        height={1800}
        caption="Still export captures the current frame or an exact timeline position as PNG, JPG, or WebP."
      />

      <h2>Formats</h2>
      <table>
        <thead><tr><th>Output</th><th>Formats</th><th>Transparency</th></tr></thead>
        <tbody>
          <tr><td>Video</td><td>H.264 / MP4, H.265 / MP4, VP9 / WebM</td><td>WebM alpha is available only when the installed encoder passes RAV&apos;s decoded-alpha probe</td></tr>
          <tr><td>Animated image</td><td>APNG, GIF</td><td>APNG preserves full alpha; GIF uses binary transparency</td></tr>
          <tr><td>Still image</td><td>PNG, JPG, WebP</td><td>PNG and WebP support alpha; JPG is opaque</td></tr>
        </tbody>
      </table>
      <p>
        Formats appear only when the desktop encoder capability check succeeds. RAV verifies the
        encoder tools and runs small encode/decode probes rather than assuming that an executable
        on disk supports every advertised codec.
      </p>
      <p>
        Open <strong>Settings → About</strong> to see the active Rive Web runtime and the exact
        FFmpeg, ffprobe, and optional gifski versions reported by that capability service. Desktop
        packages use pinned, hash-verified Jellyfin FFmpeg/ffprobe resources with their required
        license notices and corresponding source; production does not fall back to arbitrary tools
        on <code>PATH</code>. Missing optional tools remain labeled unavailable.
      </p>

      <h2>Output settings</h2>
      <ul>
        <li><strong>Width and height</strong> default to the artboard. Lock aspect ratio, or set both dimensions for an exact frame size.</li>
        <li><strong>Source scale</strong> offers 100%, 75%, 50%, and 25% shortcuts. Video dimensions must be even.</li>
        <li><strong>Frame rate</strong> supports 1–60 FPS; GIF is capped at 50 FPS and presets may lower it.</li>
        <li><strong>Quality</strong> is 1–100 for lossy encoders. PNG and APNG are lossless, so the control is hidden for them.</li>
        <li><strong>Transparent</strong> is available only for formats that can preserve alpha. Otherwise the matte color is rendered behind the animation.</li>
        <li><strong>Save to</strong> uses the yellow folder button to choose both a folder and filename. Changing format clears an incompatible chosen path.</li>
      </ul>
      <p>
        RAV preserves existing files unless an MCP caller explicitly opts into replacement. The
        desktop picker returns to unchanged settings when cancelled.
      </p>

      <h2>GIF size controls</h2>
      <table>
        <thead><tr><th>Preset</th><th>Behavior</th></tr></thead>
        <tbody>
          <tr><td>Source</td><td>Keeps requested dimensions and rate within format limits</td></tr>
          <tr><td>Balanced</td><td>Caps the longest edge at 960 px and frame rate at 20 FPS</td></tr>
          <tr><td>Small</td><td>Caps the longest edge at 480 px and frame rate at 12 FPS</td></tr>
          <tr><td>Custom</td><td>Uses the dimensions, FPS, quality, repeat, and encoder controls you set</td></tr>
          <tr><td>Target size</td><td>Runs up to five attempts against a MiB target and reports whether the target was met</td></tr>
        </tbody>
      </table>
      <p>
        Target size can adjust quality only, or quality plus frame rate and dimensions. RAV keeps
        the animation duration intact. An unmet target is reported with the smallest completed
        result instead of being presented as a guarantee.
      </p>

      <DocsFigure
        src={asset("/docs/2.5.5/gif-size-options.webp")}
        alt="RAV GIF export settings showing preset, target-size, frame-rate, quality, repeat, and encoder controls"
        width={2500}
        height={1800}
        caption="GIF presets combine resolution and frame-rate caps with explicit quality, repeat, encoder, and best-effort target-size controls."
      />

      <h2>Progress, results, and recovery</h2>
      <p>
        Capture, finalization, encoding, verification, and saving appear in the bottom status bar
        with a RAV-yellow progress indicator. The usual playback status returns when the job ends.
        Open <strong>EXPORT</strong> again to inspect the latest result; RAV does not add a duplicate
        result button to the toolbar.
      </p>
      <p>
        RAV fully decodes a completed artifact before publishing it. Low disk space can stop a
        nonempty recording and finish the accepted portion. A renderer, transport, or write error
        retains acknowledged capture data for recovery instead of publishing an unverified file.
        Explicit cancellation removes that job&apos;s temporary capture.
      </p>

      <DocsFigure
        src={asset("/docs/2.5.5/export-progress-status.webp")}
        alt="RAV bottom status bar showing media export progress with a lime progress indicator"
        width={2500}
        height={1800}
        caption="Capture, drain, encoding, validation, and publication progress stays in the normal status area instead of obscuring the canvas."
      />

      <h2>Agent and MCP access</h2>
      <p>
        The same media service is available through eight MCP tools: capability discovery,
        timeline/still export, recording start and stop, job status and cancellation, explicit
        frame stepping, and normalized pointer input. Recording requests can also schedule typed
        ViewModel values, triggers, images, and pointer events on the recording clock. See the
        <Link href={asset("/docs/mcp")}> MCP reference</Link> for the tool list and the repository&apos;s
        detailed media contract for complete request fields.
      </p>

      <h2>Timeline scrubber behavior</h2>
      <p>
        The timeline row appears only for linear-animation preview. Toggle frames or seconds, drag
        the large current-time indicator to seek, and read boundaries from the authored duration.
        The indicator updates on every rendered frame during playback. State machines hide the row
        because they do not have a fixed authored duration.
      </p>
    </>
  );
}
