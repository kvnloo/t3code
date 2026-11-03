# Media for the OpenUI app cards experiment

Recordings and screenshots for the draft PR from `experiment/openui-app-cards`.
Kept off the code branch so the PR diff stays code only.

- `app-cards-demo.mp4` / `.gif`: one real Hermes (gpt-6.1-sol) turn in T3 Code
  built from the PR head, with the demo connectors (canned data, nothing booked).
  Typing and the model's wait are sped up 3x and labeled; the board and taps are real time.
- `live-activity-row.png`: the running row over time (Thinking, Tool, then
  "Reading from GitHub · #128" with the GitHub mark).
- `board.png`, `ride-and-route-cards.png`, `pull-request-card.png`: the rendered cards.
- `t3-app-cards-film.mp4` / `.gif`: the 40 s launch film, 1920×1080 at 60 fps with sound. Made with
  fframes 1.3: a stageshow mock for the "before", the same real recording with a virtual camera
  (labeled 3× and 1.5×), and synthesized sound (claude-motion sfx). Source: kvnloo/launch-videos,
  `films/t3-openui-app-cards-v2`.
