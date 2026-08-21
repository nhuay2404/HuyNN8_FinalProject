// Generated from work/levels.tsv by work/sync-levels.mjs. Do not edit by hand.
export const LEVELS_SHEET = `# Level sheet. One row is one level. Edit here, then run: npm run levels
# layers: layers separated by |, rows inside a layer by / (top row first), . is an empty cell
# UPPERCASE = plain block, lowercase = block wrapped in a barrel (1 layer by default)
# barrel_layers: deepen one cluster, written x.y.z:n (n up to 3), several clusters separated by ;
# links: tie two clusters together, written x.y.z>x.y.z, several pairs separated by ;
# leave goal_order and goal_split empty to let the game work them out. An empty column uses the default.
level	name	dims	layers	barrel_layers	links	goal_order	goal_split	goal_slots	batch_slots	shot_limit	notes
1	Prism 4x3x2	4x3x2	PPPO/YYYY/RRRO|RRRO/BBBB/GGGG			R,G,Y,B,P,O					the prototype original level
2	Interleaved layers	4x2x2	BBRR/GGYY|RRBB/YYGG			B,R,G,Y					example - replace with a real level
3	Split purple goal	3x3x2	PPP/OOO/RRR|RRR/PPP/OOO			P,O,R	P:3+3				example - shows what goal_split does
4	Barrel test	4x3x2	RR.Y/G..Y/pp.Y|RR.Y/...Y/bb.Y	0.0.1:3		Y,B,R,G,P					purple = 1 layer (claim the green cluster above it to peel). blue = 3 layers, black > grey > white
5	Link test	4x2x2	RROO/RROO|ppYY/ppYY		0.0.0>0.0.1	R,O,Y,P					red-purple link. purple has 1 barrel layer, so shooting red does nothing until purple is uncovered
`;
