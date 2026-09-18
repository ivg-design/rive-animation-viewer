# RAV idea: VM interaction timeline

Captured: 2026-09-10

Status: Parked feature idea for future design

Origin: Scripted ViewModel (VM) session recording

## Concept

Add a traditional DCC-style timeline to RAV for authoring VM interactions. The
user can plan property changes visually, refine their timing and easing, and
execute a precisely timed recording of the resulting animation.

Keep the workflow straightforward: property tracks, keyframes, a curve graph
editor, and in/out markers. This extends the idea behind scripted VM session
recording into a visual authoring workflow.

## Requested capabilities

- Add any exposed VM property to the timeline as a track, including numbers,
  colors, enums, triggers, booleans, and strings.
- Add, edit, move, and delete keyframes with precise timing.
- Adjust easing for interpolated values through a curve graph editor.
- Set in/out markers to define the recording range.
- Preview the planned interactions and execute a recording that follows their
  authored timing.

## Keyframe behavior

| Property type | Intended behavior |
| --- | --- |
| Number | Interpolate between keyed values, with editable easing OR hold frames. |
| Color | Interpolate between keyed colors, with editable easing OR hold frames. opacity is keyed separately from color, so one key for color change from A->B with color picker, and separately 0-100% opacity |
| Boolean | Hold keyframes: retain the value until the next key, then switch. No interpolation OR hold frames. |
| Enum | Hold keyframes: retain the selection until the next key, then switch. No interpolation. |
| Trigger | Discrete, non-interpolated keys in the same hold-style category; fire the trigger at its keyed time. |
| String | Keyable, with interpolation desired. The meaning and behavior of string interpolation require further discussion.<br>as a first feature release lets limit to hold frames and Type On effect - where I can key start end kfs and the text animates letter by letter in the range, and in later release add text animator type behavior similar to AE - but simpler |
| Timing & replay | fps is as authored in the source - standard 60 fps (default in rive) and if something alternate detected on load then that. Scrubbing is a live playback of the vm - so all keyframed values exercise backwards and forwards. <br>- essentially we are creating a pre-programmed state machine - so i am not sure how it can be scrubbed - need to investigate.<br>- what to do with with hover/click/drag interactions - how can we author that?<br>- Repeated recordings should follow the same authored timing<br>- ability to save/load the "authored" timeline for a specific file - a sidecar json or similar or .rav file which will be a zip+of a json+.riv file together that can be opened in RAV<br>- need to determine how the timeline is  exported to standalone export<br> |

The hold-keyframe reference is the familiar After Effects model. Trigger keys
represent events rather than persistent values; replay and scrubbing behavior
will need explicit design.


## Relationship to existing work and resume point

The repository's [media interaction schedule](../MEDIA_INTERACTION_SCHEDULE.md)
documents timed VM assignments and trigger operations during recording. Use
that contract as the starting point when evaluating timeline execution and the
additional support needed for interpolation.

Revisit when planning the next extension to scripted VM session recording.
The smallest next step is a timeline sketch covering one interpolated track,
one hold track, one trigger track, a curve editor, and in/out markers, followed
by a discussion of string interpolation. This note captures the feature intent;
implementation and release scheduling remain future work.
this 