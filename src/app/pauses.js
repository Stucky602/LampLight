// What pauses the sim and what lets it go again. The sim holds while any pause reason is active
// (loop.js); rendering carries on.
//   blur        the window lost focus (alt-tab, a notification): resumes on focus
//   controller  the controller in use disconnected (even if a spare pad is still plugged in):
//               resumes when a controller connects, or when the player actually uses something
//               else (the keyboard, the mouse, the spare pad). Pulling out a pad nobody was
//               using doesn't pause anyone.
// Returns a function that removes everything it added.

export function wirePauses({ loop, input, win }) {
  const onBlur = () => loop.pause('blur');
  const onFocus = () => loop.resume('blur');
  win.addEventListener('blur', onBlur);
  win.addEventListener('focus', onFocus);
  const offs = [
    // Emitted before the prompts fall back, so input.device and input.activePad still describe
    // what was in use.
    input.on('disconnect', (e) => { if (input.device === 'gamepad' && e.index === input.activePad) loop.pause('controller'); }),
    input.on('connect', () => loop.resume('controller')),
    // 'device' fires only for real input (never for the silent fallback when a pad goes away),
    // including picking up a different pad.
    input.on('device', () => loop.resume('controller')),
  ];
  return () => {
    win.removeEventListener('blur', onBlur);
    win.removeEventListener('focus', onFocus);
    for (const off of offs) off();
  };
}
