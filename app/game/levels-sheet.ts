// Generated from work/levels.tsv by work/sync-levels.mjs. Do not edit by hand.
export const LEVELS_SHEET = `# Level sheet. One row is one level. Edit here, then run: npm run levels
# layers: layers separated by |, rows inside a layer by / (top row first), . is an empty cell
# one letter per block: R G Y B P O. Case is ignored.
# batch_blocks: how many claimed blocks may sit in the reserve at once. Never below the level's biggest cluster.
# weak_points: x.y.z:FACE entries separated by ~. Every same-colour FACE_6 cluster needs 1-3.
# pacing: prefer one point per cluster and two exposed opening goals; keep forced off-goal blockers rare and acyclic.
# rainbow: target_count fly per round on seeded straight lines; spawn_gap is what the seeded spacing is measured against; target_duration is seconds on screen.
# leave goal_order and goal_split empty to work them out. An empty optional cell uses the default; weak_points is required.
level	name	dims	layers	goal_order	goal_split	goal_slots	batch_blocks	shot_limit	weak_points	rainbow_target_count	rainbow_spawn_gap	rainbow_target_duration	notes
1	Prism 4x3x2	4x3x2	PPPO/YYYY/RRRO|RRRO/BBBB/GGGG	R,G,Y,B,P,O					1.2.0:NY~3.2.1:NY~1.1.0:NY~1.0.0:PZ~3.0.0:PZ~0.2.1:PZ~2.1.1:NZ~0.0.1:PZ	3		7	balanced cadence: readable onboarding with layered reveals
2	Interleaved layers	4x2x2	BBRR/GGYY|RRBB/YYGG	B,R,G,Y					0.1.0:PZ~2.1.0:NY~0.0.0:PZ~2.0.0:PZ~0.1.1:PZ~2.1.1:PZ~0.0.1:PY~2.0.1:PY	3		7	balanced cadence: one intentional off-goal Yellow blocker
3	Split purple goal	3x3x2	PPP/OOO/RRR|RRR/PPP/OOO	P,O,R	P:3+3				1.2.0:PZ~1.1.0:PZ~1.0.0:PZ~1.2.1:NY~0.1.1:PZ~0.0.1:PZ	3		7	balanced cadence: quick starts with delayed reveals
`;
