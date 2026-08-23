// Generated from work/levels.tsv by work/sync-levels.mjs. Do not edit by hand.
export const LEVELS_SHEET = `# Level sheet. One row is one level. Edit here, then run: npm run levels
# layers: layers separated by |, rows inside a layer by / (top row first), . is an empty cell
# one letter per block: R G Y B P O. Case is ignored.
# batch_blocks: how many claimed blocks may sit in the reserve at once. Never below the level's biggest cluster.
# weak_points: x.y.z:FACE entries separated by ~. Every same-colour FACE_6 cluster needs 1-3.
# rainbow_paths: path IDs 1-12 separated by |. Its count must match rainbow_target_count.
# leave goal_order and goal_split empty to work them out. Empty optional numeric cells use defaults; weak_points is required.
level	name	dims	layers	goal_order	goal_split	goal_slots	batch_blocks	shot_limit	round_time	weak_points	rainbow_trigger	rainbow_target_count	rainbow_spawn_gap	rainbow_target_duration	rainbow_reward_sec	rainbow_paths	notes
1	Prism 4x3x2	4x3x2	PPPO/YYYY/RRRO|RRRO/BBBB/GGGG	R,G,Y,B,P,O					90	0.2.0:NZ~3.2.1:PZ~0.1.0:NX~0.0.0:NZ~0.2.1:PZ~0.1.1:PZ~0.0.1:PZ~3.0.0:PX	25	3	2	4	5	1|8|11	the prototype original level
2	Interleaved layers	4x2x2	BBRR/GGYY|RRBB/YYGG	B,R,G,Y					90	0.1.0:NZ~2.1.0:NZ~0.0.0:NZ~2.0.0:NZ~0.1.1:PZ~2.1.1:PZ~0.0.1:PZ~2.0.1:PZ	25	3	2	4	5	1|8|11	example - replace with a real level
3	Split purple goal	3x3x2	PPP/OOO/RRR|RRR/PPP/OOO	P,O,R	P:3+3				90	0.2.0:NZ~0.1.0:NZ~0.0.0:NZ~0.2.1:PZ~0.1.1:PZ~0.0.1:PZ	25	3	2	4	5	1|8|11	example - shows what goal_split does
`;
