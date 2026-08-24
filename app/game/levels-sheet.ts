// Generated from work/levels.tsv by work/sync-levels.mjs. Do not edit by hand.
export const LEVELS_SHEET = `# Level sheet. One row is one level. Edit here, then run: npm run levels
# layers: layers separated by |, rows inside a layer by / (top row first), . is an empty cell
# one letter per block: R G Y B P O K A. K is black/ink; A is ash gray. Case is ignored.
# batch_blocks: how many claimed blocks may sit in the reserve at once. Never below the level's biggest cluster.
# coordinates: x runs LEFT->RIGHT, y BOTTOM->TOP, z BACK->FRONT; all start at 0 in the Puzzle's default pose.
# weak_points: x.y.z:FACE entries separated by ~. Prefer FRONT BACK RIGHT LEFT TOP BOTTOM; legacy PZ NZ PX NX PY NY also work.
# example: 4.6.7:FRONT puts the mark on the front face of block (4,6,7). The face rotates with that block.
# Every same-colour FACE_6 cluster needs 1-3 points. A neighbour directly beyond FACE hides the point until removed.
# pacing: prefer one point per cluster and two exposed opening goals; keep forced off-goal blockers rare and acyclic.
# rainbow: RARE BY RULE. At most 1 target per level, and most levels get 0 - leave target_count at 0 unless the level
#   is long enough to earn a bonus. A round with two of them had the next one arriving before the last had left.
#   spawn_gap doubles as the earliest it can show: the first target lands at gap x 0.5-1.0 seconds, so a bigger gap on a
#   longer level keeps it out of the opening. target_duration is seconds on screen.
# leave goal_order and goal_split empty to work them out. An empty optional cell uses the default; weak_points is required.
level	name	dims	layers	goal_order	goal_split	goal_slots	batch_blocks	shot_limit	weak_points	rainbow_target_count	rainbow_spawn_gap	rainbow_target_duration	notes
1	Umbrella Trial	9x8x9	........./........./........./........./........./........./........./.........|........./....P..../..BPPPR../..BPPPR../........./........./........./.........|........./..BPPPR../.BBPPPRR./.BBPPPRR./........./........./........./.........|...BPR.../..BBPRR../.BBBPRRR./.BBBPRRR./........./........./........./.........|...BOO.../.BBBOOOO./.BBBOOOO./.BBBOOOO./....O..../....O..../....O..../....O....|...GYO.../..GGYOO../.GGGYOOO./.GGGYOOO./........./........./........./.........|........./..GYYYO../.GGYYYOO./.GGYYYOO./........./........./........./.........|........./....Y..../..GYYYO../..GYYYO../........./........./........./.........|........./........./........./........./........./........./........./.........	Y,O,B,P,R,G			38		2.5.7:FRONT~3.5.7:LEFT~6.5.7:LEFT~3.5.4:RIGHT~3.5.2:FRONT~5.5.3:BACK	1	36	7	one-level scale trial: 132-block umbrella, six colours, one forced G16 batch and a five-step Weak Point reveal chain; rows 2-8 stay unchanged
2	Turn to look	2x2x1	GR/GR	R,G			2		1.1.0:PZ~0.0.0:NZ	0			variation: one mark faces you like level 1, the other is round the back and has to be turned into view
3	Park it	1x2x2	R/G|Y/Y	R,G,Y			2		0.1.1:PZ~0.1.0:PZ~0.0.0:PZ	0			expansion: a Yellow wall hides both goal marks, so Yellow has to wait in the reserve first
4	Read the order	2x2x2	RR/GG|YY/GG	Y,G,R			4		0.1.1:PZ~0.0.0:NZ~0.1.0:PZ	0			combination: a front mark, a mark round the back, and Red waiting behind Yellow
5	Full sweep	3x2x2	YRR/BBY|YGG/BBY	G,Y,B,R	Y:2+2		4		1.1.1:PZ~0.1.1:PZ~0.0.1:PZ~1.1.0:PZ~2.0.0:NZ	1	24	7	graduation: split goal, blocker, back mark, and a reserve tight enough to lose
6	Prism 4x3x2	4x3x2	PPPO/YYYY/RRRO|RRRO/BBBB/GGGG	R,G,Y,B,P,O					1.2.0:NY~3.2.1:NY~1.1.0:NY~1.0.0:PZ~3.0.0:PZ~0.2.1:PZ~2.1.1:NZ~0.0.1:PZ	1	30	7	balanced cadence: readable onboarding with layered reveals
7	Interleaved layers	4x2x2	BBRR/GGYY|RRBB/YYGG	B,R,G,Y					0.1.0:PZ~2.1.0:NY~0.0.0:PZ~2.0.0:PZ~0.1.1:PZ~2.1.1:PZ~0.0.1:PY~2.0.1:PY	0			balanced cadence: one intentional off-goal Yellow blocker
8	Split purple goal	3x3x2	PPP/OOO/RRR|RRR/PPP/OOO	P,O,R	P:3+3				1.2.0:PZ~1.1.0:PZ~1.0.0:PZ~1.2.1:NY~0.1.1:PZ~0.0.1:PZ	1	24	7	balanced cadence: quick starts with delayed reveals
9	Pixel Spark Portrait	13x13x2	KKKKKKKKKKKKK/KAAKKAAAAKKKK/KAAYKAAAYYOKK/KKYYKAAYYOOKK/KKYYYYYYYOOKK/KKYYYYYYYOOKK/KKYYYKYYYROKK/KKYKKKYYYROKK/KKYYYKYYYOOKK/KAYYYYOOOOKAK/KAAYYOOOOOKAK/KAAAKKOOOOKKK/KKKKKKKKKKKKK|............./............./.AA.....YY.../............./.....YYYY..../.....Y......./.....Y...R.../.........R.../............./.......OOO.../.........O.../.........OO../.............	Y,O,A,R,K		2	74		10.1.0:FRONT~5.6.0:FRONT~1.10.1:FRONT~6.11.0:FRONT~1.2.0:FRONT~11.3.0:FRONT~6.8.1:FRONT~8.3.1:FRONT~9.6.1:FRONT	0			one new framed pixel-art relief: black/gray/yellow/orange/red reference palette, 187 blocks, raised highlights, and two ink Weak Points revealed after the colour layer clears
`;
