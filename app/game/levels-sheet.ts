// Generated from work/levels.tsv by work/sync-levels.mjs. Do not edit by hand.
export const LEVELS_SHEET = `# Level sheet. One row is one level. Edit here, then run: npm run levels
# layers: layers separated by |, rows inside a layer by / (top row first), . is an empty cell
# one letter per block: R G Y B P O. Case is ignored.
# batch_blocks: how many claimed blocks may sit in the reserve at once. Never below the level's biggest cluster.
# weak_points: x.y.z:FACE entries separated by ~. Every same-colour FACE_6 cluster needs 1-3.
# rainbow: target_count fly per round on seeded free-form paths; spawn_gap is what the seeded spacing is measured against; target_duration is seconds on screen.
# leave goal_order and goal_split empty to work them out. An empty optional cell uses the default; weak_points is required.
level	name	dims	layers	goal_order	goal_split	goal_slots	batch_blocks	shot_limit	weak_points	rainbow_target_count	rainbow_spawn_gap	rainbow_target_duration	notes
1	Prism 4x3x2	4x3x2	PPPO/YYYY/RRRO|RRRO/BBBB/GGGG	R,G,Y,B,P,O					0.2.0:NZ~3.2.1:PZ~0.1.0:NX~0.0.0:NZ~0.2.1:PZ~0.1.1:PZ~0.0.1:PZ~3.0.0:PX~1.1.0:PZ~2.1.1:NZ~1.0.0:PZ~2.0.1:NZ~1.2.0:PZ~1.2.1:NZ~3.0.0:PZ	3		4.5	the prototype original level
2	Interleaved layers	4x2x2	BBRR/GGYY|RRBB/YYGG	B,R,G,Y					0.1.0:NZ~2.1.0:NZ~0.0.0:NZ~2.0.0:NZ~0.1.1:PZ~2.1.1:PZ~0.0.1:PZ~2.0.1:PZ~1.1.0:PZ~3.0.0:PZ~1.1.1:NZ~3.0.1:NZ	3		4.5	example - replace with a real level
3	Split purple goal	3x3x2	PPP/OOO/RRR|RRR/PPP/OOO	P,O,R	P:3+3				0.2.0:NZ~0.1.0:NZ~0.0.0:NZ~0.2.1:PZ~0.1.1:PZ~0.0.1:PZ~1.2.0:PZ~1.1.0:PZ~1.2.1:NZ~1.0.1:NZ	3		4.5	example - shows what goal_split does
`;
